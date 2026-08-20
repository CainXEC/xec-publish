export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { rateLimit, getClientIp } from '@/lib/rateLimit'
import { adminDb } from '@/lib/db'
import { FEED_MIN_XEC } from '@/lib/feedPricing'
import { computePaymentSplit, buildPaywallBip21, buildPublishFeeBip21 } from '@/lib/paymentSplit'
import { encodeFeedOpReturnRaw, FEED_ACTION } from '@/lib/feedProtocol'
import { isReaction, payeeFor } from '@/lib/reactions'

// Reacting to a COMMENT is the same paid reaction as reacting to a feed post — a
// POWR `like` (OP_5) whose targetTxid is the comment's on-chain txid, carrying
// WHICH emoji, a flat 100 XEC. A positive emoji pays the commenter 94/6; a 👎
// pays the platform 100%. Mirrors /api/feed/react/prepare, but the target is
// resolved from `comments`, not `feed_posts`.
const REACT_COST_XEC = FEED_MIN_XEC

/**
 * Build the payment request (BIP21 + OP_RETURN) for reacting to a comment. Pure —
 * no DB write. The client pays this exact request; /api/comments/react/confirm
 * detects the tx and records the reaction. Multi-react: no per-wallet lock.
 */
export async function POST(request) {
  const ip = getClientIp(request)
  if (!(await rateLimit(ip, 30, 60, 'comment-react-prepare'))) {
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

  // Comments only ever get liked (no repost/quote on a comment).
  if (body?.action != null && body.action !== 5 && body.action !== 'like') {
    return NextResponse.json({ error: 'Unsupported reaction' }, { status: 400 })
  }
  const action = FEED_ACTION.LIKE

  const targetTxid =
    typeof body?.targetTxid === 'string' ? body.targetTxid.trim().toLowerCase() : ''
  if (!/^[0-9a-f]{64}$/.test(targetTxid)) {
    return NextResponse.json({ error: 'Invalid target comment' }, { status: 400 })
  }

  // The reaction carries WHICH emoji, validated against the fixed palette; the
  // emoji decides who gets paid (commenter 94/6 vs platform 100% for 👎).
  const emoji = body?.emoji
  if (!isReaction(emoji)) {
    return NextResponse.json({ error: 'Unknown reaction' }, { status: 400 })
  }
  const platformPaid = payeeFor(emoji) === 'platform'
  const amountXec = REACT_COST_XEC // flat 100 XEC

  const supabase = adminDb()
  const { data: target, error } = await supabase
    .from('comments')
    .select('payout_address, deleted_at, txid')
    .eq('txid', targetTxid)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!target?.payout_address || target.deleted_at) {
    return NextResponse.json({ error: 'Comment not found' }, { status: 404 })
  }

  let opReturnRaw
  try {
    opReturnRaw = encodeFeedOpReturnRaw({ action, targetTxid })
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Failed to build commitment' }, { status: 500 })
  }

  // 👎 (platform-paid) → a single 100%-platform output; every other emoji → the
  // 94/6 split (commenter + platform).
  let bip21Url
  let payAddress
  if (platformPaid) {
    bip21Url = buildPublishFeeBip21(platformAddress, amountXec, opReturnRaw)
    payAddress = platformAddress
  } else {
    const split = computePaymentSplit(amountXec)
    if (!split) {
      return NextResponse.json({ error: 'Invalid price' }, { status: 500 })
    }
    bip21Url = buildPaywallBip21(
      target.payout_address,
      platformAddress,
      split.authorAmount,
      split.platformAmount,
      opReturnRaw,
    )
    payAddress = target.payout_address
  }

  return NextResponse.json({
    ok: true,
    action,
    targetTxid,
    emoji,
    costXec: amountXec,
    amountXec,
    bip21Url,
    // The payment's primary output — the client watches it on a Chronik
    // websocket to confirm the moment the payment lands (platform for 👎, else
    // the commenter). Server still gates on finality via the reconcile sweep.
    payAddress,
    cashtabUrl: `https://cashtab.com/#/send?bip21=${bip21Url}`,
    preparedAt: Math.floor(Date.now() / 1000),
  })
}
