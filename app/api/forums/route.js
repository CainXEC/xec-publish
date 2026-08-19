export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/db'
import { displayHandlesByAccountId } from '@/lib/authorDisplayHandles'

/**
 * The forum directory — every forum, most posts first, with each runner's live
 * @handle byline. Public.
 */
export async function GET() {
  const supabase = adminDb()
  const { data, error } = await supabase
    .from('forums')
    .select('id, slug, title, description, runner_account_id, post_count, created_at')
    .order('post_count', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

  const rows = data ?? []
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
