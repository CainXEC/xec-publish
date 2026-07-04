export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rateLimit'
import { createServerSupabase } from '@/lib/supabase-server'
import { FEED_MIN_XEC } from '@/lib/feedPricing'
import { computePaymentSplit, buildPaywallBip21 } from '@/lib/paymentSplit'
import { encodeFeedOpReturnRaw, FEED_ACTION } from '@/lib/feedProtocol'

// Likes and reposts carry no content of their own — just a flat 100 XEC payment
// split 94/6 to the reacted-to post's author and the platform.
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
  const ip = request.headers.get('x-forwarded-for') || 'unknown'
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

  const supabase = createServerSupabase()
  const { data: target, error } = await supabase
    .from('feed_posts')
    .select('payout_address, deleted_at')
    .eq('txid', targetTxid)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!target?.payout_address || target.deleted_at) {
    return NextResponse.json({ error: 'Post not found' }, { status: 404 })
  }

  const split = computePaymentSplit(REACT_COST_XEC)
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
    costXec: REACT_COST_XEC,
    amountXec: REACT_COST_XEC,
    bip21Url,
    cashtabUrl: `https://cashtab.com/#/send?bip21=${bip21Url}`,
    preparedAt: Math.floor(Date.now() / 1000),
  })
}
