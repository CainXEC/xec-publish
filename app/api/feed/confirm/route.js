export const runtime = 'nodejs'

import { NextResponse, after } from 'next/server'
import { revalidateTag } from 'next/cache'
import { rateLimit, getClientIp } from '@/lib/rateLimit'
import { adminDb } from '@/lib/db'
import { getAuthedAccount } from '@/lib/authHelpers'
import { FEED_CACHE_TAG, profileCacheTag, getFeedPostForCard } from '@/lib/getFeed'
import { feedOpenGraphMetadata } from '@/lib/feedOgMetadata'
import { priceFeedPost } from '@/lib/feedPricing'
import { contentHashHex, FEED_ACTION } from '@/lib/feedProtocol'
import { normalizePoll } from '@/lib/feedPoll'
import { findFeedPayment, verifyFeedTxid } from '@/lib/verifyFeedPost'
import { resolveOrCreateAccount, primaryAddressForAccount } from '@/lib/walletAuth'
import { formatIdentity } from '@/lib/formatIdentity'
import { displayHandlesByAccountId } from '@/lib/authorDisplayHandles'
import { isBlockedPair } from '@/lib/feedBlocks'
import { recordFeedNotification, recordFeedMentionNotifications } from '@/lib/feedNotifications'
import { mintPaySession } from '@/lib/paySession'
import { feeRecipientForTarget, getForumById, forumFeeContext } from '@/lib/forums'
import { splitForumContent } from '@/lib/forumPost'

const FEED_POST_COLUMNS =
  'id, txid, action, parent_txid, quoted_txid, content, content_hash, title, author_account_id, author_identity, payer_address, payout_address, amount_sats, forum_id, created_at, card_kind, card_meta'

function normalizeAction(action) {
  if (action === 2 || action === 'reply') return FEED_ACTION.REPLY
  if (action === 3 || action === 'quote') return FEED_ACTION.QUOTE
  if (action === 1 || action === 'post' || action == null) return FEED_ACTION.POST
  return null
}

/**
 * The live byline fields the feed renders server-side (attachLiveIdentity in
 * getFeed): the account's current "@handle" + its handle color, or the raw
 * address (no color) if it holds no handle. Attaching these to the returned post
 * lets a client optimistically prepend it with the RIGHT color instead of the
 * default neon — otherwise a purple-handle poster's fresh post shows green until
 * the next server render.
 */
async function liveDisplayFields(supabase, row) {
  const fallback = row?.payer_address || row?.author_identity || null
  if (!row?.author_account_id) return { displayIdentity: fallback, displayColor: null }
  const map = await displayHandlesByAccountId([row.author_account_id], supabase)
  const entry = map[row.author_account_id]
  return {
    displayIdentity: entry?.handle ? `@${entry.handle}` : fallback,
    displayColor: entry?.color ?? null,
  }
}

/**
 * Detect and record the on-chain payment for a feed post/reply. The content
 * hash is re-derived server-side and matched against the OP_RETURN commitment —
 * a client-sent hash is never trusted. Idempotent on txid. Returns
 * `awaiting_payment` while the tx hasn't been seen yet (client re-polls).
 */
export async function POST(request) {
  const ip = getClientIp(request)
  if (!(await rateLimit(ip, 60, 60, 'feed-confirm'))) {
    return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 })
  }

  const platformAddress = process.env.PLATFORM_XEC_ADDRESS?.trim()
  if (!platformAddress) {
    return NextResponse.json({ error: 'Platform payment address not configured' }, { status: 500 })
  }

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const action = normalizeAction(body?.action)
  if (action == null) {
    return NextResponse.json({ error: 'Unsupported action' }, { status: 400 })
  }

  const priced = priceFeedPost(body?.content)
  if (!priced.ok) {
    return NextResponse.json({ error: priced.error }, { status: 400 })
  }
  const content = body.content
  const { costXec } = priced
  const contentHash = contentHashHex(content)

  // A poll rides on a top-level POST: the question is `content` (priced +
  // hashed like any post), the options + eligibility live in card_meta. The
  // server re-normalizes so a client can't inject option ids or extra fields.
  let cardKind = null
  let cardMeta = null
  if (body?.poll != null) {
    if (action !== FEED_ACTION.POST) {
      return NextResponse.json({ error: 'A poll must be a top-level post.' }, { status: 400 })
    }
    cardMeta = normalizePoll(body.poll)
    if (!cardMeta) {
      return NextResponse.json(
        { error: 'A poll needs a question and 2–4 options.' },
        { status: 400 },
      )
    }
    cardKind = 'poll'
  }

  const supabase = adminDb()

  // `targetTxid` is the referenced post (reply→parent, quote→quoted). It rides
  // in the OP_RETURN and, for a reply, determines who gets paid.
  let targetTxid = null
  let quotedTxid = null
  let payoutAddress = null
  let parentAuthorAccountId = null
  let quotedAuthorAccountId = null
  // Which forum this post belongs to (NULL = the global Feed). A reply INHERITS
  // its parent's forum (so a thread stays in the forum); a top-level post takes
  // the client's forumId, validated below.
  let forumId = null
  if (action === FEED_ACTION.REPLY) {
    targetTxid = typeof body?.parentTxid === 'string' ? body.parentTxid.trim().toLowerCase() : ''
    if (!/^[0-9a-f]{64}$/.test(targetTxid)) {
      return NextResponse.json({ error: 'Invalid parent post' }, { status: 400 })
    }
    const { data: parent, error } = await supabase
      .from('feed_posts')
      .select('payout_address, author_account_id, forum_id')
      .eq('txid', targetTxid)
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!parent?.payout_address) {
      return NextResponse.json({ error: 'Parent post not found' }, { status: 404 })
    }
    payoutAddress = parent.payout_address
    parentAuthorAccountId = parent.author_account_id
    forumId = parent.forum_id ?? null
  } else if (action === FEED_ACTION.QUOTE) {
    targetTxid = typeof body?.quotedTxid === 'string' ? body.quotedTxid.trim().toLowerCase() : ''
    if (!/^[0-9a-f]{64}$/.test(targetTxid)) {
      return NextResponse.json({ error: 'Invalid quoted post' }, { status: 400 })
    }
    quotedTxid = targetTxid
    // Who owns the quoted post? Used to notify them once the quote is recorded.
    const { data: quoted } = await supabase
      .from('feed_posts')
      .select('author_account_id')
      .eq('txid', quotedTxid)
      .maybeSingle()
    quotedAuthorAccountId = quoted?.author_account_id ?? null
  }

  // A top-level post/quote can belong to a forum (the composer on a forum page
  // sends its id). Validate it exists; the post fee is unchanged (100% platform).
  if ((action === FEED_ACTION.POST || action === FEED_ACTION.QUOTE) && body?.forumId) {
    const forum = await getForumById(supabase, String(body.forumId))
    if (!forum) return NextResponse.json({ error: 'Forum not found' }, { status: 404 })
    forumId = forum.id
  }

  // A self-reply (you reply to your OWN post) is forced 100% platform — no 94%
  // rebate to yourself. Detected the SAME way prepare did (the logged-in session
  // matching the parent's author), so both agree on the split and the paid tx
  // always matches what we verify.
  let selfReply = false
  if (action === FEED_ACTION.REPLY && parentAuthorAccountId) {
    // Best-effort session read (throws outside a request scope, e.g. in tests);
    // no session → not a self-reply (falls back to the normal 94/6 split).
    let acct = null
    try {
      acct = await getAuthedAccount()
    } catch {
      /* no request scope / no session */
    }
    selfReply = Boolean(acct?.accountId && acct.accountId === parentAuthorAccountId)
  }

  // A reply to a post in a forum sends the 6% fee leg to the forum RUNNER, not
  // the platform — verification requires the payment landed there. (Self-reply
  // and top-level posts are 100% platform, so the recipient stays the platform.)
  const feeRecipient =
    action === FEED_ACTION.REPLY && !selfReply
      ? await feeRecipientForTarget(supabase, targetTxid, { platformOnly: false, platformAddress })
      : platformAddress

  const expected = {
    action,
    parentTxid: targetTxid,
    contentHash,
    platformAddress: feeRecipient,
    payoutAddress: selfReply ? null : payoutAddress,
    costXec,
    platformOnly: selfReply,
  }

  // Skip txs already recorded for this exact content (avoids re-attributing an
  // identical post from another wallet).
  const { data: existingRows } = await supabase
    .from('feed_posts')
    .select('txid')
    .eq('content_hash', contentHash)
  const excludeTxids = new Set((existingRows ?? []).map((r) => r.txid))

  const providedTxid =
    typeof body?.txid === 'string' && /^[0-9a-f]{64}$/i.test(body.txid.trim())
      ? body.txid.trim().toLowerCase()
      : null
  const sinceUnix = Number(body?.since) || 0

  const match = providedTxid
    ? await verifyFeedTxid(providedTxid, expected)
    : await findFeedPayment(expected, { sinceUnix, excludeTxids })

  if (!match) {
    return NextResponse.json({ ok: true, status: 'awaiting_payment' })
  }

  // Publish at 0-conf the moment the payment is SEEN, so the feed feels instant.
  // Finality is no longer a gate here — instead the row is recorded as
  // provisional (finalized_at NULL) and the reconcile sweep either stamps it
  // final or deletes it if the tx never finalizes (a double-spend that lost).
  // Low-stakes by design: a feed payment is peer-to-peer on-chain, so a reversed
  // tx just means the coins never arrived — no custodied funds are ever at risk.
  const finalizedAt = match.isFinal ? new Date().toISOString() : null

  // If this txid is already recorded, return it (idempotent).
  const { data: already } = await supabase
    .from('feed_posts')
    .select(FEED_POST_COLUMNS)
    .eq('txid', match.txid)
    .maybeSingle()
  if (already) {
    const display = await liveDisplayFields(supabase, already)
    return NextResponse.json({ ok: true, status: 'posted', post: { ...already, replyCount: 0, ...display } })
  }

  const resolved = await resolveOrCreateAccount(match.payerAddress)

  // Reply gate: reject if the replier and the parent's author are in a block
  // relationship (either direction). The blocked party can't normally reach the
  // thread (it's hidden from them), so this is the server-side backstop against a
  // direct call. The payment already landed on-chain; we simply don't record the
  // reply — no blocked reply enters the feed.
  if (action === FEED_ACTION.REPLY && parentAuthorAccountId) {
    if (await isBlockedPair(supabase, parentAuthorAccountId, resolved.accountId)) {
      return NextResponse.json({ error: 'You can’t reply to this post.' }, { status: 403 })
    }
  }

  // Snapshot payout + byline from the account's LIVE primary, not the raw
  // payer: a payment signed by a linked non-primary wallet (the Pocket) must
  // still route replies' earnings to the account's real payout wallet, and a
  // handle-less account's byline must show its primary address — never the
  // hot pocket key. For a normal wallet payer, primary == payer (no change).
  const displayAddress = await primaryAddressForAccount(resolved.accountId, match.payerAddress)
  const authorIdentity = formatIdentity(resolved.handle, displayAddress)

  const row = {
    txid: match.txid,
    action,
    parent_txid: action === FEED_ACTION.REPLY ? targetTxid : null,
    quoted_txid: quotedTxid,
    content,
    content_hash: contentHash,
    author_account_id: resolved.accountId,
    author_identity: authorIdentity,
    payer_address: match.payerAddress,
    payout_address: displayAddress, // snapshot: replies to this post pay the poster's account
    amount_sats: match.sats,
    forum_id: forumId, // NULL = global Feed; a forum id keeps it contained to that forum
    // A top-level forum post carries a title: content is `title \n\n body`, so
    // derive the title from the (already hash-verified) content — never trust a
    // client-sent title, since only the content is covered by the proof hash.
    title:
      action === FEED_ACTION.POST && forumId ? splitForumContent(content).title : null,
    finalized_at: finalizedAt,
    card_kind: cardKind,
    card_meta: cardMeta,
  }

  const { data: inserted, error: insertError } = await supabase
    .from('feed_posts')
    .insert(row)
    .select(FEED_POST_COLUMNS)
    .single()

  if (insertError) {
    // Unique txid violation → someone recorded it between our check and insert.
    if (insertError.code === '23505') {
      const { data: raced } = await supabase
        .from('feed_posts')
        .select(FEED_POST_COLUMNS)
        .eq('txid', match.txid)
        .maybeSingle()
      if (raced) {
        const display = await liveDisplayFields(supabase, raced)
        return NextResponse.json({ ok: true, status: 'posted', post: { ...raced, replyCount: 0, ...display } })
      }
    }
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  // Notifications are best-effort and OFF the critical path: the poster is
  // blocked on this response, so recording the reply/quote ping AND resolving
  // @mentions (up to a few extra DB queries + inserts) is deferred to after() —
  // it runs post-response instead of delaying the row the client nests. after()
  // throws synchronously outside a request scope (handlers invoked directly in
  // tests); there we just fire-and-forget so behavior is unchanged.
  const recordNotifications = async () => {
    if (action === FEED_ACTION.REPLY && parentAuthorAccountId) {
      await recordFeedNotification(supabase, {
        recipientAccountId: parentAuthorAccountId,
        actorAccountId: resolved.accountId,
        actorIdentity: authorIdentity,
        type: 'reply',
        postTxid: targetTxid,
        // A reply pays the parent author (payoutAddress above) — carry the amount
        // so the bell can show "· N XEC". (A quote doesn't pay the quoted author,
        // so it stays amountless below.)
        amountSats: match.sats,
        // The reply's OWN txid (distinct from postTxid, the target) — lets the
        // notifications page show the reply's actual text.
        actionTxid: inserted.txid,
      })
      // A reply to a post in a forum earns the RUNNER the 6% fee — tell them, so
      // their earnings are visible. Skipped for a self-reply (pays the platform),
      // the runner's own reply, and when the runner IS the parent author (already
      // notified above). `feeRecipient` !== platformAddress means the fee was
      // redirected to the runner, so this only fires for a real forum reply.
      if (!selfReply && feeRecipient !== platformAddress) {
        const forumCtx = await forumFeeContext(supabase, targetTxid)
        if (
          forumCtx &&
          forumCtx.runnerAccountId !== resolved.accountId &&
          forumCtx.runnerAccountId !== parentAuthorAccountId
        ) {
          await recordFeedNotification(supabase, {
            recipientAccountId: forumCtx.runnerAccountId,
            actorAccountId: resolved.accountId,
            actorIdentity: authorIdentity,
            type: 'forum_fee',
            postTxid: targetTxid,
            amountSats: Math.round(match.sats * 0.06),
            actionTxid: inserted.txid,
          })
        }
      }
    } else if (action === FEED_ACTION.QUOTE && quotedAuthorAccountId) {
      await recordFeedNotification(supabase, {
        recipientAccountId: quotedAuthorAccountId,
        actorAccountId: resolved.accountId,
        actorIdentity: authorIdentity,
        type: 'quote',
        postTxid: inserted.txid,
      })
    }
    // Notify anyone @-tagged in the post's text, excluding whoever the reply/quote
    // above already pinged so they don't get a duplicate.
    await recordFeedMentionNotifications(supabase, {
      content,
      actorAccountId: resolved.accountId,
      actorIdentity: authorIdentity,
      postTxid: inserted.txid,
      excludeAccountIds: [parentAuthorAccountId, quotedAuthorAccountId].filter(Boolean),
    })
  }
  try {
    after(recordNotifications)
  } catch {
    void recordNotifications()
  }

  // Freshen the shared For You cache so the new post (or a reply's bumped count)
  // shows within seconds instead of waiting out the revalidate window. Cheap:
  // feed writes are payment-gated, so this can't thrash the cache.
  revalidateTag(FEED_CACHE_TAG)
  // A profile shows the account's own posts with their denormalized counts, so
  // freshen the poster's profile — and, when this bumps a count on someone else's
  // post (a reply's parent, a quote's target), theirs too.
  revalidateTag(profileCacheTag(resolved.accountId))
  if (parentAuthorAccountId) revalidateTag(profileCacheTag(parentAuthorAccountId))
  if (quotedAuthorAccountId) revalidateTag(profileCacheTag(quotedAuthorAccountId))

  const display = await liveDisplayFields(supabase, inserted)
  // A titled forum post stores `title \n\n body` in content; hand the client the
  // split form (title separate, content = body) so it renders like getFeed's rows.
  const clientContent = inserted.title
    ? splitForumContent(inserted.content).body
    : inserted.content
  const response = NextResponse.json({
    ok: true,
    status: 'posted',
    post: { ...inserted, content: clientContent, replyCount: 0, ...display },
  })

  // Pay doubles as login: mint a 'pay'-scope session for the payer (never
  // downgrade an existing challenge session). Best-effort — the post is already
  // recorded regardless.
  mintPaySession(request, response, resolved.accountId, match.payerAddress, 'feed-confirm')

  // Pre-warm this post's X/OG share card so the crawler never eats the ~4-5s
  // cold render. Each post's card is a UNIQUE next/og URL, so when the poster
  // shares the fresh link, Twitterbot is the FIRST to fetch it — a cold render
  // that overruns its timeout, after which X caches a no-card result. Warming the
  // CDN here (post-response via after(), so the poster isn't blocked) means that
  // crawler fetch is served from cache in ~100ms. Best-effort; content posts only.
  // after() throws SYNCHRONOUSLY when called outside a request scope — e.g. when
  // this handler is invoked directly in integration tests rather than through the
  // Next server runtime. The warm is best-effort, so guard the registration too;
  // under the real runtime after() registers the callback and returns normally.
  try {
    after(async () => {
      try {
        const card = await getFeedPostForCard(inserted.txid)
        if (!card?.content) return
        const siteUrl =
          process.env.NEXT_PUBLIC_SITE_URL || 'https://www.proofofwriting.com'
        const meta = feedOpenGraphMetadata({
          post: card,
          pageUrl: `${siteUrl}/feed/${card.txid}`,
        })
        const imgUrl = meta?.openGraph?.images?.[0]?.url
        if (imgUrl) await fetch(imgUrl, { headers: { 'user-agent': 'pow-og-warm' } })
      } catch (e) {
        console.warn(
          '[feed-confirm] OG card pre-warm failed (non-fatal):',
          e instanceof Error ? e.message : e,
        )
      }
    })
  } catch (e) {
    console.warn(
      '[feed-confirm] OG card pre-warm skipped (no request scope):',
      e instanceof Error ? e.message : e,
    )
  }

  return response
}
