export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rateLimit'
import { createServerSupabase } from '@/lib/supabase-server'
import { priceFeedPost } from '@/lib/feedPricing'
import { computePaymentSplit, buildPaywallBip21, buildPublishFeeBip21 } from '@/lib/paymentSplit'
import { contentHashHex, encodeFeedOpReturnRaw, FEED_ACTION } from '@/lib/feedProtocol'

function normalizeAction(action) {
  if (action === 2 || action === 'reply') return FEED_ACTION.REPLY
  if (action === 1 || action === 'post' || action == null) return FEED_ACTION.POST
  return null
}

/**
 * Build the payment request (BIP21 + OP_RETURN) for a feed post or reply.
 * Pure — no DB write. The client pays this exact request; the content hash it
 * commits to is re-derived and checked on-chain at /api/feed/confirm.
 */
export async function POST(request) {
  const ip = request.headers.get('x-forwarded-for') || 'unknown'
  if (!(await rateLimit(ip, 30, 60, 'feed-prepare'))) {
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
    return NextResponse.json({ error: priced.error, chars: priced.chars }, { status: 400 })
  }
  const { chars, costXec } = priced
  const contentHash = contentHashHex(body.content)

  let parentTxid = null
  let payoutAddress = null
  if (action === FEED_ACTION.REPLY) {
    parentTxid = typeof body?.parentTxid === 'string' ? body.parentTxid.trim().toLowerCase() : ''
    if (!/^[0-9a-f]{64}$/.test(parentTxid)) {
      return NextResponse.json({ error: 'Invalid parent post' }, { status: 400 })
    }
    const supabase = createServerSupabase()
    const { data: parent, error } = await supabase
      .from('feed_posts')
      .select('payout_address')
      .eq('txid', parentTxid)
      .maybeSingle()
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!parent?.payout_address) {
      return NextResponse.json({ error: 'Parent post not found' }, { status: 404 })
    }
    payoutAddress = parent.payout_address
  }

  let opReturnRaw
  try {
    opReturnRaw = encodeFeedOpReturnRaw({ action, parentTxid, contentHash })
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Failed to build commitment' }, { status: 500 })
  }

  let bip21Url
  if (action === FEED_ACTION.POST) {
    bip21Url = buildPublishFeeBip21(platformAddress, costXec, opReturnRaw)
  } else {
    const split = computePaymentSplit(costXec)
    if (!split) {
      return NextResponse.json({ error: 'Invalid price' }, { status: 500 })
    }
    bip21Url = buildPaywallBip21(
      payoutAddress,
      platformAddress,
      split.authorAmount,
      split.platformAmount,
      opReturnRaw,
    )
  }

  return NextResponse.json({
    ok: true,
    action,
    parentTxid,
    chars,
    costXec,
    amountXec: costXec,
    contentHash,
    bip21Url,
    cashtabUrl: `https://cashtab.com/#/send?bip21=${bip21Url}`,
    preparedAt: Math.floor(Date.now() / 1000),
  })
}
