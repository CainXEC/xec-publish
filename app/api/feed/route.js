export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { getFeedPage, getFollowingFeedPage } from '@/lib/getFeed'
import { getAuthedAccount } from '@/lib/authHelpers'

/** Paginated newest-first feed of top-level posts (for client refresh / infinite scroll).
 *  scope=following restricts to accounts the signed-in viewer follows. */
export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const page = Number(searchParams.get('page')) || 1
  const scope = searchParams.get('scope') === 'following' ? 'following' : 'foryou'
  try {
    const acct = await getAuthedAccount()
    if (scope === 'following') {
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
    const { posts, hasNextPage } = await getFeedPage({
      page,
      viewerAddress: acct?.address,
      viewerAccountId: acct?.accountId ?? null,
    })
    return NextResponse.json({ posts, hasNextPage })
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Failed to load feed' }, { status: 500 })
  }
}
