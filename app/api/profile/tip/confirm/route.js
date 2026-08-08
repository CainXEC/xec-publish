export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { rateLimit, getClientIp } from '@/lib/rateLimit'
import { adminDb } from '@/lib/db'
import { FEED_TIP_MIN_XEC } from '@/lib/feedPricing'
import { verifyTipTxid, findTipPayment } from '@/lib/verifyFeedPost'
import { resolveOrCreateAccount, primaryAddressForAccount } from '@/lib/walletAuth'
import { formatIdentity } from '@/lib/formatIdentity'
import { recordFeedNotification } from '@/lib/feedNotifications'
import { mintPaySession } from '@/lib/paySession'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const FEED_TIP_COLUMNS =
  'id, txid, from_account_id, from_identity, to_account_id, payout_address, payer_address, amount_sats, created_at, finalized_at'

/**
 * Detect and record the on-chain payment for a direct author tip. Idempotent on
 * txid. Tips are repeatable (no per-tipper dedupe) — a fan can tip the same author
 * many times. Returns `awaiting_payment` while the tx hasn't been seen yet.
 */
export async function POST(request) {
  const ip = getClientIp(request)
  if (!(await rateLimit(ip, 60, 60, 'profile-tip-confirm'))) {
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

  const supabase = adminDb()
  const { data: primary, error: primaryErr } = await supabase
    .from('account_addresses')
    .select('address')
    .eq('account_id', toAccountId)
    .eq('is_primary', true)
    .maybeSingle()
  if (primaryErr) return NextResponse.json({ error: primaryErr.message }, { status: 500 })
  if (!primary?.address) {
    return NextResponse.json({ error: 'This author can’t receive tips yet.' }, { status: 404 })
  }

  // Match any tip AT OR ABOVE the floor — the tipper chooses the amount, and the
  // on-chain output records what they actually sent (match.sats).
  const expected = { payoutAddress: primary.address, costXec: FEED_TIP_MIN_XEC }

  // On the scan fallback, skip tips already recorded for this author so a repeat
  // scan (e.g. a second tip in the same session) can't re-attribute an earlier one.
  const { data: recordedRows } = await supabase
    .from('feed_tips')
    .select('txid')
    .eq('to_account_id', toAccountId)
  const excludeTxids = new Set((recordedRows ?? []).map((r) => r.txid))

  const providedTxid =
    typeof body?.txid === 'string' && /^[0-9a-f]{64}$/i.test(body.txid.trim())
      ? body.txid.trim().toLowerCase()
      : null
  const sinceUnix = Number(body?.since) || 0

  const match = providedTxid
    ? await verifyTipTxid(providedTxid, expected)
    : await findTipPayment(expected, { sinceUnix, excludeTxids })

  if (!match) {
    return NextResponse.json({ ok: true, status: 'awaiting_payment' })
  }

  // Idempotent on txid.
  const { data: already } = await supabase
    .from('feed_tips')
    .select(FEED_TIP_COLUMNS)
    .eq('txid', match.txid)
    .maybeSingle()
  if (already) {
    return NextResponse.json({ ok: true, status: 'tipped', tip: already })
  }

  const resolved = await resolveOrCreateAccount(match.payerAddress)

  // A tip pays someone ELSE. matchTipTx already rejects payer==payee, but a tipper
  // paying from a linked wallet (e.g. their Pocket) resolves to the same account —
  // block that here so no one tips their own account.
  if (resolved.accountId === toAccountId) {
    return NextResponse.json({ error: 'You can’t tip yourself.' }, { status: 400 })
  }

  // Byline snapshots the account's primary, never a linked pocket address.
  const displayAddress = await primaryAddressForAccount(resolved.accountId, match.payerAddress)
  const fromIdentity = formatIdentity(resolved.handle, displayAddress)

  // Recorded at 0-conf the moment the payment is SEEN; finalized_at stays NULL
  // until the tx is Avalanche-final (the reconcile sweep stamps or drops it).
  const finalizedAt = match.isFinal ? new Date().toISOString() : null

  const row = {
    txid: match.txid,
    from_account_id: resolved.accountId,
    from_identity: fromIdentity,
    to_account_id: toAccountId,
    payout_address: primary.address,
    payer_address: match.payerAddress,
    amount_sats: match.sats,
    finalized_at: finalizedAt,
  }

  const { data: inserted, error: insertError } = await supabase
    .from('feed_tips')
    .insert(row)
    .select(FEED_TIP_COLUMNS)
    .single()

  if (insertError) {
    // Unique txid violation → someone recorded it between our check and insert.
    if (insertError.code === '23505') {
      const { data: raced } = await supabase
        .from('feed_tips')
        .select(FEED_TIP_COLUMNS)
        .eq('txid', match.txid)
        .maybeSingle()
      if (raced) return NextResponse.json({ ok: true, status: 'tipped', tip: raced })
    }
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  // Tell the author they were tipped (best-effort). A tip is 100% to the author,
  // so amount_sats IS what they earned — the bell shows the full amount.
  await recordFeedNotification(supabase, {
    recipientAccountId: toAccountId,
    actorAccountId: resolved.accountId,
    actorIdentity: fromIdentity,
    type: 'tip',
    amountSats: match.sats,
  })

  const response = NextResponse.json({ ok: true, status: 'tipped', tip: inserted })

  // Tipping proves wallet ownership → mint a 'pay'-scope session (never downgrade
  // a stronger challenge session). ONLY when the client proved its OWN txid — on
  // the address-scan path `match` could be a stranger's tip to the same author, so
  // minting a session from it would hand the caller someone else's login.
  if (providedTxid) {
    mintPaySession(request, response, resolved.accountId, match.payerAddress, 'profile-tip-confirm')
  }

  return response
}
