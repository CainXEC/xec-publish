export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/db'
import { displayHandlesByAccountId } from '@/lib/authorDisplayHandles'

/**
 * The forum directory — ranked by total comments (sum of deep reply_count
 * across all top-level posts in the forum), most active first.
 */
export async function GET() {
  const supabase = adminDb()
  const [{ data, error }, { data: commentTotals }] = await Promise.all([
    supabase
      .from('forums')
      .select('id, slug, title, description, runner_account_id, post_count, created_at')
      .limit(200),
    supabase
      .from('feed_posts')
      .select('forum_id, reply_count')
      .not('forum_id', 'is', null)
      .eq('action', 1)
      .is('deleted_at', null),
  ])
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

  // Sum deep reply_counts per forum_id
  const replyTotals = {}
  for (const p of commentTotals ?? []) {
    replyTotals[p.forum_id] = (replyTotals[p.forum_id] ?? 0) + (p.reply_count ?? 0)
  }

  const rows = (data ?? []).sort(
    (a, b) => (replyTotals[b.id] ?? 0) - (replyTotals[a.id] ?? 0),
  )

  const runnerMap = await displayHandlesByAccountId(
    rows.map((r) => r.runner_account_id),
    supabase,
  )

  const forums = rows.map((r) => ({
    slug: r.slug,
    title: r.title,
    description: r.description,
    postCount: r.post_count,
    runner: runnerMap[r.runner_account_id]?.handle
      ? `@${runnerMap[r.runner_account_id].handle}`
      : null,
  }))
  return NextResponse.json({ ok: true, forums })
}
