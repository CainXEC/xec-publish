import SearchClient from '@/components/search/SearchClient'
import { getAuthedAccount } from '@/lib/authHelpers'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Search — Proof Of Writing',
  description: 'Search articles, feed posts, and people on Proof Of Writing.',
}

const TYPES = new Set(['articles', 'posts', 'people'])

/**
 * /search?q=<query>&type=articles|posts|people — one search bar, results
 * tabbed by type. The tab is just a query param, so every state is linkable.
 */
export default async function SearchPage({ searchParams }) {
  const sp = await searchParams
  const q = typeof sp?.q === 'string' ? sp.q.slice(0, 200) : ''
  const rawType = typeof sp?.type === 'string' ? sp.type.toLowerCase() : ''
  const type = TYPES.has(rawType) ? rawType : null

  const acct = await getAuthedAccount()
  return (
    <SearchClient
      initialQuery={q}
      initialType={type}
      signedIn={acct != null}
      isAuthor={acct?.authorId != null}
    />
  )
}
