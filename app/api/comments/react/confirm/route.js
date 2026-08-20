export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { rateLimit, getClientIp } from '@/lib/rateLimit'
import { adminDb } from '@/lib/db'
import { FEED_MIN_XEC } from '@/lib/feedPricing'
import { FEED_ACTION } from '@/lib/feedProtocol'
import { findFeedPayment, verifyFeedTxid } from '@/lib/verifyFeedPost'
import { resolveOrCreateAccount, primaryAddressForAccount } from '@/lib/walletAuth'
import { formatIdentity } from '@/lib/formatIdentity'
import { recordFeedNotification } from '@/lib/feedNotifications'
import { mintPaySession } from '@/lib/paySession'
import { isReaction, payeeFor } from '@/lib/reactions'

const REACT_COST_XEC = FEED_MIN_XEC

const COMMENT_EVENT_COLUMNS =
  'id, txid, action, target_txid, actor_account_id, actor_identity, payer_address, payout_address, amount_sats, emoji, created_at'

/**
 * Detect and record the on-chain payment for a comment REACTION (emoji). Multi-
 * react: idempotent on txid only (a wallet may react as many times as it pays).
 * Mirrors /api/feed/react/confirm, but the target is a COMMENT (resolved from
 * `comments`) and the reaction is written to `comment_events`. A positive emoji
 * pays the commenter 94/6; a 👎 pays the platform 100% (verified via the split).
 * Returns `awaiting_payment` while the tx hasn't been seen yet.
 */
export async function POST(request) {
  const ip = getClientIp(request)
  if (!(await rateLimit(ip, 60, 60, 'comment-react-confirm'))) {
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

  // Comments only ever get liked/reacted (no repost/quote).
  if (body?.action != null && body.action !== 5 && body.action !== 'like') {
    return NextResponse.json({ error: 'Unsupported reaction' }, { status: 400 })
  }
  const action = FEED_ACTION.LIKE

  const targetTxid =
    typeof body?.targetTxid === 'string' ? body.targetTxid.trim().toLowerCase() : ''
  if (!/^[0-9a-f]{64}$/.test(targetTxid)) {
    return NextResponse.json({ error: 'Invalid target comment' }, { status: 400 })
  }

  // The reaction's emoji decides polarity, which must match the on-chain split.
  const emoji = body?.emoji
  if (!isReaction(emoji)) {
    return NextResponse.json({ error: 'Unknown reaction' }, { status: 400 })
  }
  const platformPaid = payeeFor(emoji) === 'platform'

  const supabase = adminDb()
  const { data: target, error: targetErr } = await supabase
    .from('comments')
    .select('payout_address, deleted_at, author_account_id, post_id')
    .eq('txid', targetTxid)
    .maybeSingle()
  if (targetErr) return NextResponse.json({ error: targetErr.message }, { status: 500 })
  if (!target?.payout_address || target.deleted_at) {
    return NextResponse.json({ error: 'Comment not found' }, { status: 404 })
  }

  const expected = {
    action,
    parentTxid: targetTxid,
    contentHash: null,
    platformAddress,
    payoutAddress: target.payout_address,
    costXec: REACT_COST_XEC,
    // 👎 must have paid the platform 100% — verification requires that exact
    // split, so a downvote can't secretly pay the commenter (or vice versa).
    platformOnly: platformPaid,
  }

  // Don't re-match a reaction tx we already recorded for this (action, target).
  const { data: recordedRows } = await supabase
    .from('comment_events')
    .select('txid')
    .eq('action', action)
    .eq('target_txid', targetTxid)
  const excludeTxids = new Set((recordedRows ?? []).map((r) => r.txid))

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

  // Record at 0-conf the moment the payment is SEEN, so the count bumps
  // instantly; the reconcile sweep either stamps it final or deletes it if the
  // tx never finalizes (a double-spend that lost). Counts are computed live, so
  // a deletion self-corrects the count on the next read.
  const finalizedAt = match.isFinal ? new Date().toISOString() : null

  // Idempotent on txid.
  const { data: already } = await supabase
    .from('comment_events')
    .select(COMMENT_EVENT_COLUMNS)
    .eq('txid', match.txid)
    .maybeSingle()
  if (already) {
    return NextResponse.json({ ok: true, status: 'reacted', event: already })
  }

  const resolved = await resolveOrCreateAccount(match.payerAddress)
  // Byline snapshots the account's primary, never a linked pocket address.
  const displayAddress = await primaryAddressForAccount(resolved.accountId, match.payerAddress)
  const actorIdentity = formatIdentity(resolved.handle, displayAddress)

  // Emoji reactions are MULTI — you can react as many times as you pay — so there
  // is no per-wallet/per-account dedup; a reaction is deduped on txid alone (the
  // idempotency check above).
  const row = {
    txid: match.txid,
    action,
    target_txid: targetTxid,
    actor_account_id: resolved.accountId,
    actor_identity: actorIdentity,
    payer_address: match.payerAddress,
    payout_address: target.payout_address,
    amount_sats: match.sats,
    emoji,
    finalized_at: finalizedAt,
  }

  const { data: inserted, error: insertError } = await supabase
    .from('comment_events')
    .insert(row)
    .select(COMMENT_EVENT_COLUMNS)
    .single()

  if (insertError) {
    // 23505: this txid raced in between our idempotency check and the insert —
    // the reaction already stands.
    if (insertError.code === '23505') {
      const { data: existing } = await supabase
        .from('comment_events')
        .select(COMMENT_EVENT_COLUMNS)
        .eq('txid', match.txid)
        .maybeSingle()
      if (existing) {
        return NextResponse.json({ ok: true, status: 'reacted', event: existing })
      }
    }
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  // Notify the COMMENT's author that their comment was liked (best-effort). A
  // like is a tip, so carry the amount actually paid. post_txid = the article's
  // post id so the bell links to /posts/<slug>#comments; the comment body is
  // NEVER referenced (comments are paywalled).
  await recordFeedNotification(supabase, {
    recipientAccountId: target.author_account_id,
    actorAccountId: resolved.accountId,
    actorIdentity,
    type: 'comment_like',
    postTxid: target.post_id ?? null,
    amountSats: match.sats,
  })

  const response = NextResponse.json({ ok: true, status: 'reacted', event: inserted })

  // Liking proves wallet ownership → mint a 'pay'-scope session. ONLY on the
  // client's OWN txid (the address-scan path can match a stranger's like on the
  // same comment, so minting from it would hand out someone else's session).
  if (providedTxid) {
    mintPaySession(request, response, resolved.accountId, match.payerAddress, 'comment-react-confirm')
  }

  return response
}
