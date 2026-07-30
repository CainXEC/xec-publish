export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { rateLimit, getClientIp } from '@/lib/rateLimit'
import { adminDb } from '@/lib/db'
import { FEED_MIN_XEC, normalizeTipXec } from '@/lib/feedPricing'
import { computePaymentSplit, buildPaywallBip21 } from '@/lib/paymentSplit'
import { encodeFeedOpReturnRaw, FEED_ACTION } from '@/lib/feedProtocol'

// Liking a COMMENT is the same paid reaction as liking a feed post — a POWR
// `like` (OP_5) whose targetTxid is the comment's on-chain txid, paying the
// comment's author 94/6. Mirrors /api/feed/react/prepare, but the target is
// resolved from `comments`, not `feed_posts`. A like carries the flat 100 XEC
// floor by default, or any larger whole-XEC custom tip.
const REACT_COST_XEC = FEED_MIN_XEC

/**
 * Build the payment request (BIP21 + OP_RETURN) for liking a comment. Pure — no
 * DB write. The client pays this exact request; /api/comments/react/confirm
 * detects the tx and records the like (deduped, one per wallet per comment).
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

  // A like can carry a custom tip; no amount → the flat 100 XEC floor. Any tip
  // must be a whole number of at least 100 XEC.
  const amountXec = body?.amountXec == null ? REACT_COST_XEC : normalizeTipXec(body.amountXec)
  if (amountXec == null) {
    return NextResponse.json(
      { error: 'Enter a whole number of at least 100 XEC.' },
      { status: 400 },
    )
  }

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

  const split = computePaymentSplit(amountXec)
  if (!split) {
    return NextResponse.json({ error: 'Invalid price' }, { status: 500 })
  }

  let opReturnRaw
  try {
    opReturnRaw = encodeFeedOpReturnRaw({ action, targetTxid })
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Failed to build commitment' }, { status: 500 })
  }

  const bip21Url = buildPaywallBip21(
    target.payout_address,
    platformAddress,
    split.authorAmount,
    split.platformAmount,
    opReturnRaw,
  )

  return NextResponse.json({
    ok: true,
    action,
    targetTxid,
    costXec: amountXec,
    amountXec,
    bip21Url,
    // The comment author's address (the like's primary output) — the client
    // watches it on a Chronik websocket to confirm the moment the payment lands.
    // Server still gates on finality via the reconcile sweep.
    payAddress: target.payout_address,
    cashtabUrl: `https://cashtab.com/#/send?bip21=${bip21Url}`,
    preparedAt: Math.floor(Date.now() / 1000),
  })
}
