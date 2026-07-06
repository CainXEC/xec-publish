export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { getCachedForYouPage, getFollowingFeedPage } from '@/lib/getFeed'
import { getAuthedAccount } from '@/lib/authHelpers'

/** Paginated newest-first feed of top-level posts (for client refresh / load more).
 *  For You is served from the shared, viewer-neutral cache (personalization is
 *  layered client-side via /api/feed/viewer-state). scope=following is inherently
 *  per-viewer and lower-traffic, so it stays personalized server-side. */
export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const page = Number(searchParams.get('page')) || 1
  const scope = searchParams.get('scope') === 'following' ? 'following' : 'foryou'
  try {
    if (scope === 'following') {
      const acct = await getAuthedAccount()
      if (!acct) {
        return NextResponse.json({ error: 'Sign in to see who you follow' }, { status: 401 })
      }
      const { posts, hasNextPage } = await getFollowingFeedPage({
        page,
        viewerAddress: acct.address,
        viewerAccountId: acct.accountId,
      })
      return NextResponse.json({ posts, hasNextPage })
    }
    const { posts, hasNextPage } = await getCachedForYouPage(page)
    return NextResponse.json({ posts, hasNextPage })
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Failed to load feed' }, { status: 500 })
  }
}
