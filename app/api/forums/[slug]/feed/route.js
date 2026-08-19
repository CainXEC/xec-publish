export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/db'
import { getAuthedAccount } from '@/lib/authHelpers'
import { getForumBySlug } from '@/lib/forums'
import { getForumFeedPage } from '@/lib/getFeed'

/** Paginated newest-first feed of ONE forum's posts (client refresh / load more).
 *  Per-viewer like/repost/follow state is layered client-side via
 *  /api/feed/viewer-state, same as the global Feed. */
export async function GET(request, { params }) {
  const { slug: raw } = await params
  const slug = typeof raw === 'string' ? raw.trim() : ''
  const { searchParams } = new URL(request.url)
  const cursor = searchParams.get('cursor') || null

  try {
    const forum = await getForumBySlug(adminDb(), slug)
    if (!forum) return NextResponse.json({ error: 'Forum not found' }, { status: 404 })

    const acct = await getAuthedAccount()
    const { posts, nextCursor } = await getForumFeedPage({
      forumId: forum.id,
      cursor,
      viewerAddress: acct?.address ?? '',
      viewerAccountId: acct?.accountId ?? null,
    })
    return NextResponse.json({ posts, nextCursor })
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Failed to load forum' }, { status: 500 })
  }
}
