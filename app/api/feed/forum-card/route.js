export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/db'
import { getForumBySlug } from '@/lib/forums'
import { displayHandlesByAccountId } from '@/lib/authorDisplayHandles'

/**
 * Resolve an on-site forum slug to a shallow preview card. Used to hydrate the
 * card for a freshly-posted feed entry (the confirm route returns an undecorated
 * post, so the client fetches the card here) — server-rendered feeds get the same
 * shape attached in getFeed. Returns 404 for unknown forums.
 */
export async function GET(request) {
  const slug = request.nextUrl.searchParams.get('slug')?.trim() ?? ''
  if (!slug) {
    return NextResponse.json({ ok: false, error: 'Missing slug.' }, { status: 400 })
  }

  const supabase = adminDb()
  const forum = await getForumBySlug(supabase, slug)
  if (!forum) {
    return NextResponse.json({ ok: false, error: 'Forum not found.' }, { status: 404 })
  }

  const runnerMap = await displayHandlesByAccountId([forum.runner_account_id], supabase)

  return NextResponse.json({
    ok: true,
    card: {
      slug: forum.slug,
      title: forum.title ?? '',
      description: forum.description ?? '',
      postCount: forum.post_count ?? 0,
      runner: runnerMap[forum.runner_account_id]?.handle
        ? `@${runnerMap[forum.runner_account_id].handle}`
        : null,
    },
  })
}
