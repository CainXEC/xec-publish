import SearchResultsClient from '@/components/SearchResultsClient'
import { searchPosts } from '@/lib/searchPosts'

export default async function SearchPage({ searchParams }) {
  const params = await searchParams
  const query = typeof params?.q === 'string' ? params.q : ''
  const rawPage = typeof params?.page === 'string' ? params.page : '1'
  const parsed = Number.parseInt(rawPage, 10)
  const page = Number.isFinite(parsed) && parsed > 0 ? parsed : 1

  const { posts, hasNextPage, total } = await searchPosts({ query, page })

  return (
    <SearchResultsClient
      query={query}
      posts={posts}
      page={page}
      hasNextPage={hasNextPage}
      total={total}
    />
  )
}
