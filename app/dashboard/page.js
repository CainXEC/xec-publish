import { redirect } from 'next/navigation'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import DashboardClient from '@/components/dashboard/DashboardClient'
import { getAuthedAccount } from '@/lib/authHelpers'
import { getXecBalanceSats } from '@/lib/xecBalance'
import { getAccountFeedPage, getAccountRepliesPage } from '@/lib/getFeed'
export default async function DashboardPage() {
  const acct = await getAuthedAccount()
  // Any logged-in wallet reaches its dashboard — including a brand-new address
  // that's a valid reader account with no author row yet. The author-keyed
  // queries below only run when there's an author row; a reader sees the empty
  // "write your first post" state.
  if (!acct) {
    redirect('/login')
  }
  // Live wallet balance for the logged-in address — fetched concurrently with the
  // author queries below so it doesn't add serial latency.
  const walletBalancePromise = getXecBalanceSats(acct.address)
  // The account's own feed posts (Posts tab) and replies (Replies tab) — keyed on
  // accountId, so they populate even for a reader account with no article/author
  // row. Fetched concurrently too.
  const feedTabsPromise = Promise.all([
    getAccountFeedPage({ accountId: acct.accountId, viewerAddress: acct.address, viewerAccountId: acct.accountId }),
    getAccountRepliesPage({ accountId: acct.accountId, viewerAddress: acct.address, viewerAccountId: acct.accountId }),
  ])
  const authorId = acct.authorId
  const admin = createSupabaseAdminClient()
  const supabase = admin // all queries below run on the service-role client now
  const [
    { data: posts, error: postsError },
    { data: author },
    { data: notifications },
    { data: unlockRows },
  ] = authorId
    ? await Promise.all([
        supabase
          .from('posts')
          .select('*')
          .eq('author_id', authorId)
          .order('published', { ascending: true })
          .order('created_at', { ascending: false }),
        supabase
          .from('authors')
          .select('username, bio, xec_address')
          .eq('id', authorId)
          .maybeSingle(),
        supabase
          .from('notifications')
          .select('id, message, post_id, comment_id, read, created_at, posts(slug, title, legacy)')
          .eq('author_id', authorId)
          .eq('read', false)
          .order('created_at', { ascending: false })
          .limit(20),
        admin
          ? admin
              .from('unlocks')
              .select('amount_xec, post_id, posts!inner(author_id)')
              .eq('posts.author_id', authorId)
              .eq('posts.published', true)
          : Promise.resolve({ data: null }),
      ])
    : [{ data: [], error: null }, { data: null }, { data: [] }, { data: null }]
  const rows = unlockRows ?? []
  const walletXecRaw = await walletBalancePromise
  const [feedPage, repliesPage] = await feedTabsPromise
  // The welcome byline should reflect the LIVE identity (a bound handle if the
  // account holds one, else the raw wallet address) — never the legacy
  // authors.username, which may name a handle the wallet no longer/never held.
  const identity = acct.handle ? `@${acct.handle}` : acct.address
  const profileHref = `/@${encodeURIComponent(acct.handle ?? acct.address)}`

  return (
    <DashboardClient
      identity={identity}
      handleColor={acct.handle ? acct.handleColor : null}
      profileHref={profileHref}
      bio={author?.bio ?? ''}
      xecAddress={author?.xec_address ?? ''}
      notifications={notifications ?? []}
      initialPosts={posts ?? []}
      loadError={postsError?.message ?? null}
      initialTotalUnlocks={rows.length}
      initialWalletXecRaw={walletXecRaw}
      viewerAccountId={acct.accountId}
      initialFeedPosts={feedPage.posts}
      initialFeedReplies={repliesPage.posts}
    />
  )
}
