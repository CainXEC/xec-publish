export const runtime = 'nodejs'
export const dynamic = 'force-dynamic' // shuffle rotates per request; never cache

import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/db'
import { displayHandlesByAccountId } from '@/lib/authorDisplayHandles'

// Fisher-Yates shuffle (returns a new array). Used to RANDOMLY rotate the forum
// directory each load — while there are few forums, random order gives every one
// equal exposure instead of a rich-get-richer size/activity ranking. Swap for a
// real ranker later (recent breadth-weighted activity was the plan).
function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/**
 * The forum directory — every forum in a RANDOMLY ROTATED order (fair exposure),
 * with each runner's live @handle byline. Public; not cached, so the order
 * changes each load.
 */
export async function GET() {
  const supabase = adminDb()
  const { data, error } = await supabase
    .from('forums')
    .select('id, slug, title, description, runner_account_id, post_count, created_at')
    .limit(200)
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

  const rows = shuffle(data ?? [])
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
