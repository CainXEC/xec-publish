export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { rateLimit, getClientIp } from '@/lib/rateLimit'
import { adminDb } from '@/lib/db'
import { priceFeedPost } from '@/lib/feedPricing'
import { contentHashHex, FEED_ACTION } from '@/lib/feedProtocol'
import { verifyCommentTxid, findCommentPayment } from '@/lib/verifyFeedPost'
import { resolveCommenter, resolveParentPayout, toEcashAddr } from '@/lib/commentGate'
import { payoutAddressForAuthorId } from '@/lib/accountAuthorLink'
import { resolveOrCreateAccount, primaryAddressForAccount } from '@/lib/walletAuth'
import { formatIdentity } from '@/lib/formatIdentity'
import { recordArticleNotification, recordFeedNotification } from '@/lib/feedNotifications'
import { mintPaySession } from '@/lib/paySession'

const COMMENT_COLUMNS =
  'id, txid, action, parent_id, parent_txid, content, author_account_id, author_identity, payer_address, created_at, deleted_at'

/**
 * Detect + record the on-chain payment for a paid comment/reply. The content
 * hash is re-derived server-side and matched against the OP_RETURN commitment —
 * a client-sent hash is never trusted. Idempotent on txid. Returns
 * `awaiting_payment` while the tx hasn't been seen yet (client re-polls).
 */
export async function POST(request) {
  const ip = getClientIp(request)
  if (!(await rateLimit(ip, 60, 60, 'comment-confirm'))) {
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

  const postId = typeof body?.postId === 'string' ? body.postId.trim() : ''
  if (!postId) {
    return NextResponse.json({ error: 'Missing postId' }, { status: 400 })
  }

  const supabase = adminDb()

  // Entitlement: must be a proven reader of the article to comment.
  const who = await resolveCommenter(request, postId, supabase)
  if (!who.ok) {
    return NextResponse.json({ error: who.error }, { status: who.status })
  }

  const priced = priceFeedPost(body?.content)
  if (!priced.ok) {
    return NextResponse.json({ error: priced.error }, { status: 400 })
  }
  const content = body.content
  const { costXec } = priced
  const contentHash = contentHashHex(content)

  // Re-resolve the payee (never trust the client): a reply pays the parent
  // comment's author (paid or legacy, threaded by parent_id); a top-level
  // comment pays the article author.
  const parentId =
    typeof body?.parentId === 'string' && body.parentId.trim() ? body.parentId.trim() : null

  let action
  let payoutAddress
  let parentTxid = null
  let parentAuthorAccountId = null
  if (parentId) {
    const { data: parent, error } = await supabase
      .from('comments')
      .select('id, txid, payout_address, author_account_id, payer_address, post_id, deleted_at')
      .eq('id', parentId)
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!parent || parent.deleted_at || String(parent.post_id) !== String(postId)) {
      return NextResponse.json({ error: 'Parent comment not found' }, { status: 404 })
    }
    const payee = await resolveParentPayout(parent)
    if (!payee?.payoutAddress) {
      return NextResponse.json(
        { error: "Can't reply to this comment — its author can't be paid." },
        { status: 409 },
      )
    }
    payoutAddress = payee.payoutAddress
    parentTxid = payee.parentTxid
    parentAuthorAccountId = payee.parentAccountId
    action = parentTxid ? FEED_ACTION.COMMENT_REPLY : FEED_ACTION.COMMENT
  } else {
    action = FEED_ACTION.COMMENT
    const { data: post, error } = await supabase
      .from('posts')
      .select('author_id')
      .eq('id', postId)
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!post?.author_id) {
      return NextResponse.json({ error: 'Article not found' }, { status: 404 })
    }
    payoutAddress = toEcashAddr(await payoutAddressForAuthorId(supabase, post.author_id))
    if (!payoutAddress) {
      return NextResponse.json({ error: "This article's author can't receive comments yet" }, { status: 409 })
    }
  }

  const expected = { action, parentTxid, contentHash, platformAddress, payoutAddress, costXec }

  // Skip txs already recorded for this exact content (avoids re-attributing an
  // identical comment paid from another wallet).
  const { data: existingRows } = await supabase
    .from('comments')
    .select('txid')
    .eq('content_hash', contentHash)
  const excludeTxids = new Set((existingRows ?? []).map((r) => r.txid).filter(Boolean))

  const providedTxid =
    typeof body?.txid === 'string' && /^[0-9a-f]{64}$/i.test(body.txid.trim())
      ? body.txid.trim().toLowerCase()
      : null
  const sinceUnix = Number(body?.since) || 0

  const match = providedTxid
    ? await verifyCommentTxid(providedTxid, expected)
    : await findCommentPayment(expected, { sinceUnix, excludeTxids })

  if (!match) {
    return NextResponse.json({ ok: true, status: 'awaiting_payment' })
  }

  // Recorded at 0-conf the moment the payment is SEEN; the reconcile sweep later
  // stamps finality or removes a row whose tx never finalizes (a lost
  // double-spend). Low-stakes: comment payments are peer-to-peer on-chain.
  const finalizedAt = match.isFinal ? new Date().toISOString() : null

  // Already recorded? Return it (idempotent).
  const { data: already } = await supabase
    .from('comments')
    .select(COMMENT_COLUMNS)
    .eq('txid', match.txid)
    .maybeSingle()
  if (already) {
    return NextResponse.json({ ok: true, status: 'posted', comment: already })
  }

  // Byline follows the PROVEN payer's ACCOUNT (proof of writing), like the
  // feed. Payout + byline snapshot the account's LIVE primary, not the raw
  // payer: a comment paid from the Pocket must still route replies' earnings
  // to the real payout wallet, never the hot pocket key. For a normal wallet
  // payer, primary == payer (no change).
  const resolved = await resolveOrCreateAccount(match.payerAddress)
  const displayAddress = await primaryAddressForAccount(resolved.accountId, match.payerAddress)
  const authorIdentity = formatIdentity(resolved.handle, displayAddress)

  const row = {
    post_id: postId,
    txid: match.txid,
    action,
    parent_id: parentId,
    parent_txid: parentTxid,
    content,
    content_hash: contentHash,
    author_account_id: resolved.accountId,
    author_identity: authorIdentity,
    payer_address: match.payerAddress,
    payout_address: displayAddress, // snapshot: replies to THIS comment pay the commenter's account
    amount_sats: match.sats,
    finalized_at: finalizedAt,
  }

  const { data: inserted, error: insertError } = await supabase
    .from('comments')
    .insert(row)
    .select(COMMENT_COLUMNS)
    .single()

  if (insertError) {
    if (insertError.code === '23505') {
      const { data: raced } = await supabase
        .from('comments')
        .select(COMMENT_COLUMNS)
        .eq('txid', match.txid)
        .maybeSingle()
      if (raced) return NextResponse.json({ ok: true, status: 'posted', comment: raced })
    }
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  // Notify: a reply pings the PARENT comment's author; a top-level comment pings
  // the ARTICLE author. Best-effort — never fails the comment.
  try {
    if (parentId) {
      if (parentAuthorAccountId && parentAuthorAccountId !== resolved.accountId) {
        await recordFeedNotification(supabase, {
          recipientAccountId: parentAuthorAccountId,
          actorAccountId: resolved.accountId,
          actorIdentity: authorIdentity,
          type: 'comment',
          postTxid: postId, // article id — linkified to the article at read time
          amountSats: match.sats, // paid to the parent commenter; bell shows net
        })
      }
    } else {
      await recordArticleNotification(supabase, {
        postId,
        type: 'comment',
        actorAccountId: resolved.accountId,
        actorIdentity: authorIdentity,
        actorAddress: null,
        amountSats: match.sats, // paid to the article author; bell shows net
      })
    }
  } catch (e) {
    console.error('[comment-confirm] notify threw (comment still ok)', e)
  }

  const response = NextResponse.json({ ok: true, status: 'posted', comment: inserted })

  // Pay doubles as login: mint a 'pay'-scope session for the payer (never
  // downgrade an existing challenge session). Best-effort.
  mintPaySession(request, response, resolved.accountId, match.payerAddress, 'comment-confirm')

  return response
}
