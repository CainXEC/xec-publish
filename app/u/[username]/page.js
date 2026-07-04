import { permanentRedirect, notFound } from 'next/navigation'
import AuthorProfilePageClient from '@/components/AuthorProfilePageClient'
import { loadAuthorProfileByUsername } from '@/lib/loadAuthorProfile'
import { createServerSupabase } from '@/lib/supabase-server'

// Legacy author URL. Folds into the unified /@ system:
//   /u/<username>  ->  308  ->  /@<currentHandle>   (if the account holds one)
//                            ->  /@<xec_address>     (otherwise)
// If neither target exists (rare: author with no address), we fall through and
// render the profile inline so a currently-working page never starts 404-ing.
//
// Note: Next's App Router permanentRedirect issues a 308 (permanent) — the
// modern equivalent of a 301 for GET navigations and SEO-equivalent.

export default async function LegacyAuthorProfilePage({ params }) {
  const { username: raw } = await params
  if (typeof raw !== 'string' || !raw.trim()) {
    notFound()
  }

  const username = decodeURIComponent(raw.trim())

  const supabase = createServerSupabase()

  const { data: author } = await supabase
    .from('authors')
    .select('id, xec_address')
    .eq('username', username)
    .maybeSingle()

  if (author?.id) {
    // Prefer the account's current display handle; else the payout address.
    const { data: accounts } = await supabase
      .from('accounts')
      .select('display_handle')
      .eq('author_id', author.id)
      .not('display_handle', 'is', null)
      .limit(1)

    const currentHandle = accounts?.[0]?.display_handle ?? null
    const target = currentHandle
      ? `/@${encodeURIComponent(currentHandle)}`
      : author.xec_address
        ? `/@${encodeURIComponent(author.xec_address)}`
        : null

    // permanentRedirect throws NEXT_REDIRECT — must run outside try/catch.
    if (target) {
      permanentRedirect(target)
    }
  }

  // Fallback: no redirect target — render the legacy profile inline.
  const {
    error,
    author: a,
    posts,
    totalUnlocks,
    totalEarnings,
  } = await loadAuthorProfileByUsername(username)

  if (!a) {
    notFound()
  }

  return (
    <AuthorProfilePageClient
      author={a}
      initialPosts={posts}
      totalUnlocks={totalUnlocks}
      totalEarnings={totalEarnings}
      postsErrorMessage={error || null}
    />
  )
}
