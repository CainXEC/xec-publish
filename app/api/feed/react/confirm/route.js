export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { rateLimit, getClientIp } from '@/lib/rateLimit'
import { adminDb } from '@/lib/db'
import { FEED_MIN_XEC } from '@/lib/feedPricing'
import { FEED_ACTION } from '@/lib/feedProtocol'
import { findFeedPayment, verifyFeedTxid } from '@/lib/verifyFeedPost'
import { resolveOrCreateAccount, primaryAddressForAccount } from '@/lib/walletAuth'
import { recordFeedNotification } from '@/lib/feedNotifications'
import {
  verifySession,
  signSession,
  SESSION_COOKIE,
  SESSION_MAX_AGE_DAYS,
} from '@/lib/session'

const REACT_COST_XEC = FEED_MIN_XEC

const FEED_EVENT_COLUMNS =
  'id, txid, action, target_txid, actor_account_id, actor_identity, payer_address, payout_address, amount_sats, created_at'

function normalizeReaction(action) {
  if (action === 5 || action === 'like') return FEED_ACTION.LIKE
  if (action === 4 || action === 'repost') return FEED_ACTION.REPOST
  return null
}

function identityFor(address, handle) {
  const h = typeof handle === 'string' ? handle.trim() : ''
  return h ? `@${h}` : address
}

/**
 * Detect and record the on-chain payment for a like or repost. Idempotent on
 * txid, and deduped on (action, target, payer) so a wallet reacting twice is a
 * no-op. Returns `awaiting_payment` while the tx hasn't been seen yet.
 */
export async function POST(request) {
  const ip = getClientIp(request)
  if (!(await rateLimit(ip, 60, 60, 'feed-react-confirm'))) {
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

  const supabase = adminDb()
  const { data: target, error: targetErr } = await supabase
    .from('feed_posts')
    .select('payout_address, deleted_at, author_account_id')
    .eq('txid', targetTxid)
    .maybeSingle()
  if (targetErr) return NextResponse.json({ error: targetErr.message }, { status: 500 })
  if (!target?.payout_address || target.deleted_at) {
    return NextResponse.json({ error: 'Post not found' }, { status: 404 })
  }

  const expected = {
    action,
    parentTxid: targetTxid,
    contentHash: null,
    platformAddress,
    payoutAddress: target.payout_address,
    costXec: REACT_COST_XEC,
  }

  // Don't re-match a reaction tx we already recorded for this (action, target).
  const { data: recordedRows } = await supabase
    .from('feed_events')
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

  // Record the reaction at 0-conf the moment the payment is SEEN, so the count
  // bumps instantly. Finality is no longer a gate — the row is recorded as
  // provisional (finalized_at NULL) and the reconcile sweep either stamps it
  // final or deletes it if the tx never finalizes (a double-spend that lost, so
  // the like was never really paid for). Counts are computed live, so a deletion
  // self-corrects the count on the next read.
  const finalizedAt = match.isFinal ? new Date().toISOString() : null

  // Idempotent on txid.
  const { data: already } = await supabase
    .from('feed_events')
    .select(FEED_EVENT_COLUMNS)
    .eq('txid', match.txid)
    .maybeSingle()
  if (already) {
    return NextResponse.json({ ok: true, status: 'reacted', event: already })
  }

  const resolved = await resolveOrCreateAccount(match.payerAddress)
  // Byline snapshots the account's primary, never a linked pocket address.
  const displayAddress = await primaryAddressForAccount(resolved.accountId, match.payerAddress)
  const actorIdentity = identityFor(displayAddress, resolved.handle)

  // The DB unique key is (action, target, payer_address) — per WALLET. An
  // account with a Pocket has two wallets, so also dedupe per ACCOUNT here:
  // a wallet like + a pocket like on the same post must not double-record
  // (the payment already happened either way; we just don't double-count).
  const { data: sameAccountRows } = await supabase
    .from('feed_events')
    .select(FEED_EVENT_COLUMNS)
    .eq('action', action)
    .eq('target_txid', targetTxid)
    .eq('actor_account_id', resolved.accountId)
    .limit(1)
  if (sameAccountRows?.[0]) {
    return NextResponse.json({ ok: true, status: 'reacted', event: sameAccountRows[0] })
  }

  const row = {
    txid: match.txid,
    action,
    target_txid: targetTxid,
    actor_account_id: resolved.accountId,
    actor_identity: actorIdentity,
    payer_address: match.payerAddress,
    payout_address: target.payout_address,
    amount_sats: match.sats,
    finalized_at: finalizedAt,
  }

  const { data: inserted, error: insertError } = await supabase
    .from('feed_events')
    .insert(row)
    .select(FEED_EVENT_COLUMNS)
    .single()

  if (insertError) {
    // 23505: either this txid raced in, or this wallet already reacted (the
    // (action, target, payer) unique key). Either way the reaction stands.
    if (insertError.code === '23505') {
      const { data: existing } = await supabase
        .from('feed_events')
        .select(FEED_EVENT_COLUMNS)
        .eq('action', action)
        .eq('target_txid', targetTxid)
        .eq('payer_address', match.payerAddress)
        .maybeSingle()
      if (existing) {
        return NextResponse.json({ ok: true, status: 'reacted', event: existing })
      }
    }
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  // Notify the post's owner that it was liked/reposted (best-effort). A like is
  // a tip, so carry the amount actually paid (match.sats, which can exceed the
  // flat floor) for the bell to show "· N XEC".
  const isLike = action === FEED_ACTION.LIKE
  await recordFeedNotification(supabase, {
    recipientAccountId: target.author_account_id,
    actorAccountId: resolved.accountId,
    actorIdentity: actorIdentity,
    type: isLike ? 'like' : 'repost',
    postTxid: targetTxid,
    amountSats: isLike ? match.sats : null,
  })

  const response = NextResponse.json({ ok: true, status: 'reacted', event: inserted })

  // Reacting proves wallet ownership → mint a 'pay'-scope session (never
  // downgrade a stronger challenge session). Best-effort.
  //
  // ONLY mint when the client proved its OWN txid. On the address-scan path
  // (`providedTxid` null) `match` can be ANOTHER wallet's reaction on the same
  // post, so minting from it would hand the caller a stranger's session — a
  // session-harvest on any popular post. Recording that reaction is fine;
  // logging someone in from it is not.
  if (providedTxid) {
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
      console.error('[feed-react-confirm] session mint failed (reaction still ok)', e)
    }
  }

  return response
}
