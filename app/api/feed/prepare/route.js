export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { rateLimit, getClientIp } from '@/lib/rateLimit'
import { adminDb } from '@/lib/db'
import { priceFeedPost } from '@/lib/feedPricing'
import { computePaymentSplit, buildPaywallBip21, buildPublishFeeBip21 } from '@/lib/paymentSplit'
import { contentHashHex, encodeFeedOpReturnRaw, FEED_ACTION } from '@/lib/feedProtocol'

function normalizeAction(action) {
  if (action === 2 || action === 'reply') return FEED_ACTION.REPLY
  if (action === 3 || action === 'quote') return FEED_ACTION.QUOTE
  if (action === 1 || action === 'post' || action == null) return FEED_ACTION.POST
  return null
}

/**
 * Build the payment request (BIP21 + OP_RETURN) for a feed post or reply.
 * Pure — no DB write. The client pays this exact request; the content hash it
 * commits to is re-derived and checked on-chain at /api/feed/confirm.
 */
export async function POST(request) {
  const ip = getClientIp(request)
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

  // Reply commits to (and pays) its immediate parent; quote commits to the
  // quoted post but is your own content, so it's priced/paid like a post
  // (100% platform). `targetTxid` is the referenced post for both.
  let targetTxid = null
  let quotedTxid = null
  let payoutAddress = null
  if (action === FEED_ACTION.REPLY) {
    targetTxid = typeof body?.parentTxid === 'string' ? body.parentTxid.trim().toLowerCase() : ''
    if (!/^[0-9a-f]{64}$/.test(targetTxid)) {
      return NextResponse.json({ error: 'Invalid parent post' }, { status: 400 })
    }
    const supabase = adminDb()
    const { data: parent, error } = await supabase
      .from('feed_posts')
      .select('payout_address')
      .eq('txid', targetTxid)
      .maybeSingle()
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!parent?.payout_address) {
      return NextResponse.json({ error: 'Parent post not found' }, { status: 404 })
    }
    payoutAddress = parent.payout_address
  } else if (action === FEED_ACTION.QUOTE) {
    targetTxid = typeof body?.quotedTxid === 'string' ? body.quotedTxid.trim().toLowerCase() : ''
    if (!/^[0-9a-f]{64}$/.test(targetTxid)) {
      return NextResponse.json({ error: 'Invalid quoted post' }, { status: 400 })
    }
    const supabase = adminDb()
    const { data: quoted, error } = await supabase
      .from('feed_posts')
      .select('txid, deleted_at')
      .eq('txid', targetTxid)
      .maybeSingle()
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!quoted || quoted.deleted_at) {
      return NextResponse.json({ error: 'Quoted post not found' }, { status: 404 })
    }
    quotedTxid = targetTxid
  }

  let opReturnRaw
  try {
    opReturnRaw = encodeFeedOpReturnRaw({ action, targetTxid, contentHash })
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Failed to build commitment' }, { status: 500 })
  }

  // Post and quote are your own content → 100% platform fee. Reply splits 94/6
  // to the parent's author.
  let bip21Url
  // Address the payment's primary output lands on — handed to the client so it
  // can open a Chronik websocket on it and trigger an immediate confirm the
  // moment the payment appears, instead of waiting for the next 2.5s poll tick.
  let payAddress
  if (action === FEED_ACTION.REPLY) {
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
    payAddress = payoutAddress
  } else {
    bip21Url = buildPublishFeeBip21(platformAddress, costXec, opReturnRaw)
    payAddress = platformAddress
  }

  return NextResponse.json({
    ok: true,
    action,
    parentTxid: action === FEED_ACTION.REPLY ? targetTxid : null,
    quotedTxid,
    chars,
    costXec,
    amountXec: costXec,
    contentHash,
    bip21Url,
    payAddress,
    cashtabUrl: `https://cashtab.com/#/send?bip21=${bip21Url}`,
    preparedAt: Math.floor(Date.now() / 1000),
  })
}
