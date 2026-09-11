export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/db'
import { getAuthedAccount } from '@/lib/authHelpers'

/**
 * Undo a repost. Reposts are the only binary (one-per-account) reaction, so
 * they're the only one with an "undo" — emoji reactions are multi (you can
 * react any number of times) and have no such lock to release.
 *
 * This removes the feed_events row entirely (events have no soft-delete
 * column), which decrements the target's repost_count via the same trigger
 * that already handles the reconcile sweep's cleanup. The 100 XEC payment
 * that reposting made is permanent on-chain and is NOT refunded — this only
 * withdraws the repost's effect on counts/feed placement, the same way
 * deleting a post leaves its on-chain record intact and only stops it being
 * served. Idempotent: undoing a repost that isn't there is a no-op.
 */
export async function DELETE(request) {
  const acct = await getAuthedAccount()
  if (!acct) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const targetTxid =
    typeof body?.targetTxid === 'string' ? body.targetTxid.trim().toLowerCase() : ''
  if (!/^[0-9a-f]{64}$/.test(targetTxid)) {
    return NextResponse.json({ error: 'Invalid target post' }, { status: 400 })
  }

  const supabase = adminDb()
  const { data: existing, error: fetchError } = await supabase
    .from('feed_events')
    .select('id')
    .eq('action', 4) // repost
    .eq('target_txid', targetTxid)
    .eq('actor_account_id', acct.accountId)
    .maybeSingle()

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 })
  }
  if (!existing) {
    return NextResponse.json({ ok: true, status: 'not_reposted' })
  }

  const { error: deleteError } = await supabase.from('feed_events').delete().eq('id', existing.id)
  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, status: 'unreposted' })
}
