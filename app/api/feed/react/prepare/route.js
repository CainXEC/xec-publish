export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { rateLimit, getClientIp } from '@/lib/rateLimit'
import { adminDb } from '@/lib/db'
import { FEED_MIN_XEC } from '@/lib/feedPricing'
import { computePaymentSplit, buildPaywallBip21, buildPublishFeeBip21 } from '@/lib/paymentSplit'
import { encodeFeedOpReturnRaw, FEED_ACTION } from '@/lib/feedProtocol'
import { isReaction, payeeFor } from '@/lib/reactions'
import { feeRecipientForTarget } from '@/lib/forums'

// Reactions carry no content — just a flat 100 XEC payment. A like/emoji reaction
// normally splits 94/6 to the reacted-to post's author + platform; a 👎 (a
// "platform-paid" emoji) pays the platform 100% instead. Reposts stay 94/6.
const REACT_COST_XEC = FEED_MIN_XEC

function normalizeReaction(action) {
  if (action === 5 || action === 'like') return FEED_ACTION.LIKE
  if (action === 4 || action === 'repost') return FEED_ACTION.REPOST
  return null
}

/**
 * Build the payment request (BIP21 + OP_RETURN) for a like or repost. Pure — no
 * DB write. The client pays this exact request; /api/feed/react/confirm detects
 * the on-chain tx and records the reaction (deduped, one per wallet per post).
 */
export async function POST(request) {
  const ip = getClientIp(request)
  if (!(await rateLimit(ip, 30, 60, 'feed-react-prepare'))) {
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

  const action = normalizeReaction(body?.action)
  if (action == null) {
    return NextResponse.json({ error: 'Unsupported reaction' }, { status: 400 })
  }

  const targetTxid =
    typeof body?.targetTxid === 'string' ? body.targetTxid.trim().toLowerCase() : ''
  if (!/^[0-9a-f]{64}$/.test(targetTxid)) {
    return NextResponse.json({ error: 'Invalid target post' }, { status: 400 })
  }

  // A like now carries WHICH emoji (repost carries none). Validate against the
  // fixed palette; the emoji decides who gets paid (author vs platform for 👎).
  const emoji = action === FEED_ACTION.LIKE ? body?.emoji : null
  if (action === FEED_ACTION.LIKE && !isReaction(emoji)) {
    return NextResponse.json({ error: 'Unknown reaction' }, { status: 400 })
  }
  const platformPaid = action === FEED_ACTION.LIKE && payeeFor(emoji) === 'platform'

  const amountXec = REACT_COST_XEC // flat 100 XEC — the tip amount menu is gone

  const supabase = adminDb()
  const { data: target, error } = await supabase
    .from('feed_posts')
    .select('payout_address, deleted_at')
    .eq('txid', targetTxid)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!target?.payout_address || target.deleted_at) {
    return NextResponse.json({ error: 'Post not found' }, { status: 404 })
  }

  let opReturnRaw
  try {
    opReturnRaw = encodeFeedOpReturnRaw({ action, targetTxid })
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Failed to build commitment' }, { status: 500 })
  }

  // The fee leg (the "platform" 6%, or the 100% for 👎) goes to the FORUM RUNNER
  // when the target post is in a forum and the reaction is positive — else the
  // platform. Derived server-side from the target's forum_id (unspoofable).
  const feeRecipient = await feeRecipientForTarget(supabase, targetTxid, {
    platformOnly: platformPaid,
    platformAddress,
  })

  // 👎 (platform-paid) → single 100%-platform output, same builder posts use.
  // Everything else → the 94/6 split (author + fee recipient).
  let bip21Url
  let payAddress
  if (platformPaid) {
    bip21Url = buildPublishFeeBip21(feeRecipient, amountXec, opReturnRaw)
    payAddress = feeRecipient
  } else {
    const split = computePaymentSplit(amountXec)
    if (!split) {
      return NextResponse.json({ error: 'Invalid price' }, { status: 500 })
    }
    bip21Url = buildPaywallBip21(
      target.payout_address,
      feeRecipient,
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
    // The payment's primary output — the client watches it on a Chronik websocket
    // to confirm the moment the payment lands (platform for 👎, else the author).
    // Server still gates on finality.
    payAddress,
    cashtabUrl: `https://cashtab.com/#/send?bip21=${bip21Url}`,
    preparedAt: Math.floor(Date.now() / 1000),
  })
}
