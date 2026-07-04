import FeedClient from '@/components/feed/FeedClient'
import { getFeedPage } from '@/lib/getFeed'
import { getAuthedAccount } from '@/lib/authHelpers'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  let posts = []
  let hasNextPage = false
  let loadError = null

  try {
    const result = await getFeedPage({ page: 1 })
    posts = result.posts
    hasNextPage = result.hasNextPage
  } catch (err) {
    loadError = err?.message || 'Failed to load feed'
  }

  const acct = await getAuthedAccount()

  return (
    <FeedClient
      initialPosts={posts}
      initialHasNextPage={hasNextPage}
      initialPage={1}
      initialLoadError={loadError}
      viewerAccountId={acct?.accountId ?? null}
    />
  )
}
