import HomeClient from '@/components/HomeClient'
import { getHomepagePosts } from '@/lib/getHomepagePosts'

export default async function ArticlesPage() {
  const initialSort = 'earned'
  const initialTimeFilter = '24h'
  const initialPage = 1

  let posts = []
  let pinnedPost = null
  let hasNextPage = false
  let loadError

  try {
    const result = await getHomepagePosts({
      sort: initialSort,
      timeFilter: initialTimeFilter,
      page: initialPage,
      pageSize: 25,
      followingOnly: false,
      walletAddress: '',
    })
    posts = result.posts
    pinnedPost = result.pinnedPost
    hasNextPage = result.hasNextPage
  } catch (err) {
    loadError = err?.message || 'Failed to load posts'
  }

  return (
    <HomeClient
      initialPosts={posts}
      initialPinnedPost={pinnedPost}
      initialHasNextPage={hasNextPage}
      initialSort={initialSort}
      initialTimeFilter={initialTimeFilter}
      initialPage={initialPage}
      initialLoadError={loadError}
    />
  )
}
