export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { rateLimit, getClientIp } from '@/lib/rateLimit'
import { adminDb } from '@/lib/db'
import { FEED_TIP_MIN_XEC, normalizeTipXec } from '@/lib/feedPricing'
import { buildPublishFeeBip21 } from '@/lib/paymentSplit'
import { encodeFeedOpReturnRaw, FEED_ACTION } from '@/lib/feedProtocol'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Build the payment request (BIP21 + OP_RETURN) for a direct tip to an AUTHOR.
 * Pure — no DB write. A tip pays 100% to the author (NO platform fee), so it's a
 * SINGLE-output payment to the author's payout address carrying the bare TIP
 * marker. The recipient is resolved server-side from the account id (never a
 * client-supplied address); /api/profile/tip/confirm re-resolves the same way and
 * verifies the on-chain payment before recording anything.
 */
export async function POST(request) {
  const ip = getClientIp(request)
  if (!(await rateLimit(ip, 30, 60, 'profile-tip-prepare'))) {
    return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 })
  }

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const toAccountId = typeof body?.toAccountId === 'string' ? body.toAccountId.trim() : ''
  if (!UUID_RE.test(toAccountId)) {
    return NextResponse.json({ error: 'Invalid author' }, { status: 400 })
  }

  // No amount → the flat 100 XEC floor. Any tip must be a whole number ≥ 100 XEC.
  const amountXec = body?.amountXec == null ? FEED_TIP_MIN_XEC : normalizeTipXec(body.amountXec)
  if (amountXec == null) {
    return NextResponse.json(
      { error: 'Enter a whole number of at least 100 XEC.' },
      { status: 400 },
    )
  }

  // Resolve the author's payout address from their account's PRIMARY address —
  // the same address the byline resolves from, never a client-sent value.
  const supabase = adminDb()
  const { data: primary, error } = await supabase
    .from('account_addresses')
    .select('address')
    .eq('account_id', toAccountId)
    .eq('is_primary', true)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!primary?.address) {
    return NextResponse.json({ error: 'This author can’t receive tips yet.' }, { status: 404 })
  }
  const payoutAddress = primary.address

  let opReturnRaw
  try {
    opReturnRaw = encodeFeedOpReturnRaw({ action: FEED_ACTION.TIP })
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Failed to build commitment' }, { status: 500 })
  }

  // Single output, 100% to the author (no platform leg on a tip).
  const bip21Url = buildPublishFeeBip21(payoutAddress, amountXec, opReturnRaw)

  return NextResponse.json({
    ok: true,
    toAccountId,
    costXec: amountXec,
    amountXec,
    bip21Url,
    // The author's payout address (the tip's only output) — the client watches it
    // on a Chronik websocket to confirm the instant the payment lands.
    payAddress: payoutAddress,
    cashtabUrl: `https://cashtab.com/#/send?bip21=${bip21Url}`,
    preparedAt: Math.floor(Date.now() / 1000),
  })
}
