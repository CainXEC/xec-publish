import HomeClient from '@/components/HomeClient'
import { getHomepagePosts } from '@/lib/getHomepagePosts'

export default async function HomePage() {
  const initialSort = 'earned'
  const initialTimeFilter = '24h'
  const initialPage = 1

  try {
    const { posts, hasNextPage } = await getHomepagePosts({
      sort: initialSort,
      timeFilter: initialTimeFilter,
      page: initialPage,
      pageSize: 25,
      followingOnly: false,
      walletAddress: '',
    })

    return (
      <HomeClient
        initialPosts={posts}
        initialHasNextPage={hasNextPage}
        initialSort={initialSort}
        initialTimeFilter={initialTimeFilter}
        initialPage={initialPage}
      />
    )
  } catch (err) {
    return (
      <HomeClient
        initialPosts={[]}
        initialHasNextPage={false}
        initialSort={initialSort}
        initialTimeFilter={initialTimeFilter}
        initialPage={initialPage}
        initialLoadError={err?.message || 'Failed to load posts'}
      />
    )
  }
}
