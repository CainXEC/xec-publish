import FeedClient from '@/components/feed/FeedClient'
import { getFeedPage } from '@/lib/getFeed'
import { getAuthedAccount } from '@/lib/authHelpers'

export const dynamic = 'force-dynamic'

export default async function HomePage({ searchParams }) {
  let posts = []
  let hasNextPage = false
  let loadError = null

  const params = await searchParams
  const initialCompose =
    typeof params?.share === 'string' ? params.share.slice(0, 280) : ''

  const acct = await getAuthedAccount()

  try {
    const result = await getFeedPage({
      page: 1,
      viewerAddress: acct?.address,
      viewerAccountId: acct?.accountId ?? null,
    })
    posts = result.posts
    hasNextPage = result.hasNextPage
  } catch (err) {
    loadError = err?.message || 'Failed to load feed'
  }

  return (
    <FeedClient
      initialPosts={posts}
      initialHasNextPage={hasNextPage}
      initialPage={1}
      initialLoadError={loadError}
      viewerAccountId={acct?.accountId ?? null}
      isAuthor={acct?.authorId != null}
      initialCompose={initialCompose}
    />
  )
}
