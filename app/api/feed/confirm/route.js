export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { rateLimit } from '@/lib/rateLimit'
import { createServerSupabase } from '@/lib/supabase-server'
import { FEED_CACHE_TAG } from '@/lib/getFeed'
import { priceFeedPost } from '@/lib/feedPricing'
import { contentHashHex, FEED_ACTION } from '@/lib/feedProtocol'
import { findFeedPayment, verifyFeedTxid } from '@/lib/verifyFeedPost'
import { resolveOrCreateAccount } from '@/lib/walletAuth'
import {
  verifySession,
  signSession,
  SESSION_COOKIE,
  SESSION_MAX_AGE_DAYS,
} from '@/lib/session'

const FEED_POST_COLUMNS =
  'id, txid, action, parent_txid, quoted_txid, content, content_hash, author_account_id, author_identity, payer_address, payout_address, amount_sats, created_at'

function normalizeAction(action) {
  if (action === 2 || action === 'reply') return FEED_ACTION.REPLY
  if (action === 3 || action === 'quote') return FEED_ACTION.QUOTE
  if (action === 1 || action === 'post' || action == null) return FEED_ACTION.POST
  return null
}

function identityFor(address, handle) {
  const h = typeof handle === 'string' ? handle.trim() : ''
  return h ? `@${h}` : address
}

/**
 * Detect and record the on-chain payment for a feed post/reply. The content
 * hash is re-derived server-side and matched against the OP_RETURN commitment —
 * a client-sent hash is never trusted. Idempotent on txid. Returns
 * `awaiting_payment` while the tx hasn't been seen yet (client re-polls).
 */
export async function POST(request) {
  const ip = request.headers.get('x-forwarded-for') || 'unknown'
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

  const supabase = createServerSupabase()

  // `targetTxid` is the referenced post (reply→parent, quote→quoted). It rides
  // in the OP_RETURN and, for a reply, determines who gets paid.
  let targetTxid = null
  let quotedTxid = null
  let payoutAddress = null
  if (action === FEED_ACTION.REPLY) {
    targetTxid = typeof body?.parentTxid === 'string' ? body.parentTxid.trim().toLowerCase() : ''
    if (!/^[0-9a-f]{64}$/.test(targetTxid)) {
      return NextResponse.json({ error: 'Invalid parent post' }, { status: 400 })
    }
    const { data: parent, error } = await supabase
      .from('feed_posts')
      .select('payout_address')
      .eq('txid', targetTxid)
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!parent?.payout_address) {
      return NextResponse.json({ error: 'Parent post not found' }, { status: 404 })
    }
    payoutAddress = parent.payout_address
  } else if (action === FEED_ACTION.QUOTE) {
    targetTxid = typeof body?.quotedTxid === 'string' ? body.quotedTxid.trim().toLowerCase() : ''
    if (!/^[0-9a-f]{64}$/.test(targetTxid)) {
      return NextResponse.json({ error: 'Invalid quoted post' }, { status: 400 })
    }
    quotedTxid = targetTxid
  }

  const expected = { action, parentTxid: targetTxid, contentHash, platformAddress, payoutAddress, costXec }

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
    return NextResponse.json({ ok: true, status: 'posted', post: { ...already, replyCount: 0 } })
  }

  const resolved = await resolveOrCreateAccount(match.payerAddress)
  const authorIdentity = identityFor(match.payerAddress, resolved.handle)

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
    payout_address: match.payerAddress, // snapshot: replies to this post pay the poster
    amount_sats: match.sats,
    finalized_at: finalizedAt,
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
        return NextResponse.json({ ok: true, status: 'posted', post: { ...raced, replyCount: 0 } })
      }
    }
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  // Freshen the shared For You cache so the new post (or a reply's bumped count)
  // shows within seconds instead of waiting out the revalidate window. Cheap:
  // feed writes are payment-gated, so this can't thrash the cache.
  revalidateTag(FEED_CACHE_TAG)

  const response = NextResponse.json({
    ok: true,
    status: 'posted',
    post: { ...inserted, replyCount: 0 },
  })

  // Pay doubles as login: mint a 'pay'-scope session for the payer (never
  // downgrade an existing challenge session). Best-effort — the post is already
  // recorded regardless.
  try {
    const existing = verifySession(request.cookies.get(SESSION_COOKIE)?.value)
    const keepStronger =
      existing && existing.via === 'challenge' && existing.accountId === resolved.accountId
    if (!keepStronger) {
      response.cookies.set({
        name: SESSION_COOKIE,
        value: signSession({
          accountId: resolved.accountId,
          address: match.payerAddress,
          iat: Date.now(),
          via: 'pay',
        }),
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: SESSION_MAX_AGE_DAYS * 24 * 60 * 60,
      })
    }
  } catch (e) {
    console.error('[feed-confirm] session mint failed (post still ok)', e)
  }

  return response
}
