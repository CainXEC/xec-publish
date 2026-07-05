export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rateLimit'
import { createServerSupabase } from '@/lib/supabase-server'
import { txFinalityState } from '@/lib/ecash/finality'

// Reconcile provisional feed rows against Avalanche finality.
//
// Feed posts/replies/quotes and likes/reposts are published at 0-conf the moment
// their payment is SEEN (so the feed feels instant), recorded with finalized_at
// NULL. This sweep re-checks each provisional row:
//   - the chain says it's final  → stamp finalized_at (permanent).
//   - the chain says it never finalized AND the row is past the grace window
//     → hard-delete it (a double-spend that lost / a stuck tx — it was never
//     really paid for). Counts are computed live from the rows, so the like /
//     reply / repost count self-corrects on the next read.
//
// Honest finality lands in ~2-3s, so GRACE_MS is ~10x headroom: no valid payment
// reaches it, making a false deletion of a slow-but-real tx effectively
// impossible. A transport error (Chronik unreachable) never deletes — the row is
// left for the next sweep — so an outage can't wipe legitimately-final rows.
const GRACE_MS = 30_000

// Bound the Chronik work per invocation. Normal operation has ~0 provisional
// rows (most are born final), so the empty case is one indexed query per table
// with zero network calls; this cap only bites during a burst.
const MAX_ROWS = 60

async function reconcileTable(supabase, table, now) {
  const { data: rows, error } = await supabase
    .from(table)
    .select('id, txid, created_at')
    .is('finalized_at', null)
    .order('created_at', { ascending: true })
    .limit(MAX_ROWS)
  if (error) throw new Error(`${table}: ${error.message}`)
  if (!rows || rows.length === 0) return { checked: 0, promoted: 0, deleted: 0 }

  const states = await Promise.all(
    rows.map(async (row) => ({ row, state: await txFinalityState(row.txid) })),
  )

  const promoteIds = []
  const deleteIds = []
  for (const { row, state } of states) {
    const ageMs = now - new Date(row.created_at).getTime()
    if (state === 'final') {
      promoteIds.push(row.id)
    } else if ((state === 'pending' || state === 'missing') && ageMs > GRACE_MS) {
      deleteIds.push(row.id)
    }
    // `error`, or still within the grace window → leave it for the next sweep.
  }

  if (promoteIds.length > 0) {
    await supabase
      .from(table)
      .update({ finalized_at: new Date(now).toISOString() })
      .in('id', promoteIds)
  }
  if (deleteIds.length > 0) {
    await supabase.from(table).delete().in('id', deleteIds)
  }
  return { checked: rows.length, promoted: promoteIds.length, deleted: deleteIds.length }
}

async function runSweep() {
  const supabase = createServerSupabase()
  const now = Date.now()
  const [posts, events] = await Promise.all([
    reconcileTable(supabase, 'feed_posts', now),
    reconcileTable(supabase, 'feed_events', now),
  ])
  return { posts, events }
}

/**
 * Runs the sweep. Vercel Cron calls this on a schedule with
 * `Authorization: Bearer $CRON_SECRET`; the feed also triggers it
 * opportunistically after load (untrusted, rate-limited) so provisional rows
 * clear promptly regardless of cron cadence.
 *
 * The work is safe for anyone to trigger: it only promotes rows the chain says
 * are final and deletes rows the chain says never finalized, so a caller can
 * never corrupt good data. Untrusted callers are merely rate-limited to keep
 * them from burning Chronik lookups.
 */
export async function GET(request) {
  const secret = process.env.CRON_SECRET?.trim()
  const auth = request.headers.get('authorization') || ''
  const trusted = Boolean(secret) && auth === `Bearer ${secret}`

  if (!trusted) {
    const ip = request.headers.get('x-forwarded-for') || 'unknown'
    if (!(await rateLimit(ip, 6, 60, 'feed-reconcile'))) {
      return NextResponse.json({ error: 'Too many requests.' }, { status: 429 })
    }
  }

  try {
    const result = await runSweep()
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    console.error('[feed-reconcile] sweep failed', e)
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 })
  }
}
