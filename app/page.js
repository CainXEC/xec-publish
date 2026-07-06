import FeedClient from '@/components/feed/FeedClient'
import { getCachedForYouPage } from '@/lib/getFeed'
import { getAuthedAccount } from '@/lib/authHelpers'

export const dynamic = 'force-dynamic'

export default async function HomePage({ searchParams }) {
  let posts = []
  let hasNextPage = false
  let loadError = null

  const params = await searchParams
  const initialCompose =
    typeof params?.share === 'string' ? params.share.slice(0, 280) : ''

  // Auth is read only for page chrome (dashboard link) and for the client-side
  // personalization/own-post logic — NOT for the feed query itself. The For You
  // feed is served from a shared, viewer-neutral cache; per-viewer state (your
  // likes/reposts/follows) is layered on the client via /api/feed/viewer-state.
  const acct = await getAuthedAccount()

  try {
    const result = await getCachedForYouPage(1)
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
