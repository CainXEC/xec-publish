import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { adminDb } from '@/lib/db'
import DashboardClient from '@/components/dashboard/DashboardClient'
import { getAuthedAccount } from '@/lib/authHelpers'
import { formatIdentity } from '@/lib/formatIdentity'
import { getXecBalanceSats } from '@/lib/xecBalance'
import { getCachedAccountFeedPage } from '@/lib/getFeed'

/** Wallet balance, streamed OUTSIDE the critical path: it's a Chronik UTXO scan,
 *  so it renders behind Suspense and fills in when Chronik answers — the
 *  dashboard HTML streams immediately, nothing else waits on it. Formatting is
 *  identical to what DashboardClient used to compute from the raw prop. */
async function WalletBalanceValue({ address }) {
  const raw = await getXecBalanceSats(address) // never throws; 0 on error
  const xec = typeof raw === 'number' ? raw / 100 : 0
  return <span>{xec.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
}

export default async function DashboardPage() {
  const acct = await getAuthedAccount()
  // Any logged-in wallet reaches its dashboard — including a brand-new address
  // that's a valid reader account with no author row yet. The author-keyed
  // queries below only run when there's an author row; a reader sees the empty
  // "write your first post" state.
  if (!acct) {
    redirect('/login')
  }
  // The account's own feed posts (Posts tab) — keyed on accountId, so they
  // populate even for a reader account with no article/author row. Replies are
  // NOT fetched here: the Replies tab loads on demand via
  // /api/feed/account-replies the first time the user switches to it.
  const feedTabsPromise = getCachedAccountFeedPage({
    accountId: acct.accountId,
    viewerAddress: acct.address,
    viewerAccountId: acct.accountId,
  })
  const authorId = acct.authorId
  const supabase = adminDb() // all queries below run on the service-role client
  // Wave 1: the author's posts/profile/unlock-count, the account's linked
  // addresses, AND both follow lists run together — none of them depends on
  // another, they all key off acct alone. The posts list selects METADATA
  // ONLY (never the full `body` / generated search_tsv — the dashboard list
  // doesn't render them; the editor loads the body fresh from /dashboard/edit),
  // and the unlock total is a HEAD count (the page only shows the number,
  // fetching every row just to .length it was pure payload).
  const [authorTriple, { data: addrRows }, followersQ, followingQ] = await Promise.all([
    authorId
      ? Promise.all([
          supabase
            .from('posts')
            .select(
              'id, title, slug, teaser, legacy, published, published_at, price_xec, reading_time_minutes, created_at, author_id, publish_paid',
            )
            .eq('author_id', authorId)
            .order('published', { ascending: true })
            .order('created_at', { ascending: false }),
          supabase
            .from('authors')
            .select('username, bio, xec_address')
            .eq('id', authorId)
            .maybeSingle(),
          supabase
            .from('unlocks')
            .select('post_id, posts!inner(author_id)', { count: 'exact', head: true })
            .eq('posts.author_id', authorId)
            .eq('posts.published', true),
        ])
      : Promise.resolve([{ data: [], error: null }, { data: null }, { count: 0 }]),
    supabase
      .from('account_addresses')
      .select('address')
      .eq('account_id', acct.accountId),
    supabase
      .from('feed_follows')
      .select('follower_account_id, created_at')
      .eq('followee_account_id', acct.accountId)
      .order('created_at', { ascending: false })
      .limit(500),
    supabase
      .from('feed_follows')
      .select('followee_account_id, created_at')
      .eq('follower_account_id', acct.accountId)
      .order('created_at', { ascending: false })
      .limit(500),
  ])
  const [{ data: posts, error: postsError }, { data: author }, { count: unlockCount }] =
    authorTriple

  // ---- Library (articles this account has paid for), follower counts ----
  // Unlocks are keyed by payer_address; the account may have proven several
  // wallets, so match on all of them (both prefixed and bare forms).
  const addressForms = [
    ...new Set(
      (addrRows ?? [])
        .map((r) => String(r.address ?? '').replace(/^ecash:/, '').toLowerCase())
        .filter(Boolean)
        .flatMap((bare) => [bare, `ecash:${bare}`]),
    ),
  ]

  // Wave 2: the library scan and the follow-identity lookups run together —
  // identities only need the wave-1 follow lists, the library only needs the
  // wave-1 addresses. (They used to run as two extra sequential waves.)
  const followerIds = (followersQ.data ?? []).map((r) => r.follower_account_id)
  const followingIds = (followingQ.data ?? []).map((r) => r.followee_account_id)
  const followAccountIds = [...new Set([...followerIds, ...followingIds])]

  const [libraryQ, [{ data: followAccounts }, { data: followAddrs }]] = await Promise.all([
    addressForms.length > 0
      ? supabase
          .from('unlocks')
          .select(
            'txid, amount_xec, unlocked_at, posts(id, title, slug, legacy, price_xec, reading_time_minutes, author_id)',
          )
          .in('payer_address', addressForms)
          .order('unlocked_at', { ascending: false })
          .limit(200)
      : Promise.resolve({ data: [] }),
    followAccountIds.length > 0
      ? Promise.all([
          supabase
            .from('accounts')
            .select('id, display_handle, handle_color')
            .in('id', followAccountIds),
          supabase
            .from('account_addresses')
            .select('account_id, address')
            .in('account_id', followAccountIds)
            .eq('is_primary', true),
        ])
      : Promise.resolve([{ data: [] }, { data: [] }]),
  ])

  // Resolve each followed/following account to its display identity: the
  // handle it presents (with its chosen color) or its primary address —
  // both link to the /@<identifier> profile, which resolves either form.
  const accountCard = new Map()
  {
    const primaryByAccount = new Map(
      (followAddrs ?? []).map((a) => [a.account_id, String(a.address ?? '')]),
    )
    for (const a of followAccounts ?? []) {
      const address = primaryByAccount.get(a.id) ?? ''
      const bare = address.replace(/^ecash:/, '')
      const handle = a.display_handle?.trim() || null
      accountCard.set(a.id, {
        id: a.id,
        display: handle ? `@${handle}` : bare ? `${bare.slice(0, 10)}…${bare.slice(-4)}` : 'a reader',
        color: handle ? (a.handle_color ?? null) : null,
        href: handle
          ? `/@${encodeURIComponent(handle)}`
          : address
            ? `/@${encodeURIComponent(address)}`
            : null,
      })
    }
  }
  const followers = followerIds.map((id) => accountCard.get(id)).filter(Boolean)
  const following = followingIds.map((id) => accountCard.get(id)).filter(Boolean)

  // Byline for each library entry: the author's display handle, else their
  // payout address, shortened — same convention as everywhere else.
  const libRows = (libraryQ.data ?? []).filter((r) => {
    const p = Array.isArray(r.posts) ? r.posts[0] : r.posts
    return p?.slug && p?.title
  })
  const libAuthorIds = [
    ...new Set(
      libRows
        .map((r) => (Array.isArray(r.posts) ? r.posts[0] : r.posts)?.author_id)
        .filter(Boolean),
    ),
  ]
  const libByline = new Map()
  if (libAuthorIds.length > 0) {
    const [{ data: libAuthors }, { data: libAccounts }] = await Promise.all([
      supabase.from('authors').select('id, xec_address').in('id', libAuthorIds),
      supabase.from('accounts').select('author_id, display_handle').in('author_id', libAuthorIds),
    ])
    for (const a of libAuthors ?? []) {
      if (a.xec_address) {
        const bare = String(a.xec_address).replace(/^ecash:/, '')
        libByline.set(a.id, `${bare.slice(0, 8)}…${bare.slice(-4)}`)
      }
    }
    for (const a of libAccounts ?? []) {
      if (a.display_handle) libByline.set(a.author_id, `@${a.display_handle}`)
    }
  }
  // Dedupe by post (an account could hold several unlock rows for one post
  // across wallets); keep the earliest-listed = most recent unlock.
  const seenLibPosts = new Set()
  const library = []
  for (const r of libRows) {
    const p = Array.isArray(r.posts) ? r.posts[0] : r.posts
    if (seenLibPosts.has(p.id)) continue
    seenLibPosts.add(p.id)
    library.push({
      txid: r.txid,
      unlockedAt: r.unlocked_at,
      postId: p.id,
      title: p.title,
      slug: p.slug,
      legacy: p.legacy === true,
      priceXec: p.price_xec ?? null,
      readMinutes: p.reading_time_minutes ?? null,
      author: (p.author_id ? libByline.get(p.author_id) : null) ?? 'an author',
    })
  }

  const feedPage = await feedTabsPromise
  // The welcome byline should reflect the LIVE identity (a bound handle if the
  // account holds one, else the raw wallet address) — never the legacy
  // authors.username, which may name a handle the wallet no longer/never held.
  const identity = formatIdentity(acct.handle, acct.address)
  const profileHref = `/@${encodeURIComponent(acct.handle ?? acct.address)}`

  return (
    <DashboardClient
      identity={identity}
      handleColor={acct.handle ? acct.handleColor : null}
      profileHref={profileHref}
      bio={author?.bio ?? ''}
      xecAddress={author?.xec_address ?? ''}
      initialPosts={posts ?? []}
      loadError={postsError?.message ?? null}
      initialTotalUnlocks={unlockCount ?? 0}
      walletBalanceSlot={
        <Suspense fallback={<span>…</span>}>
          <WalletBalanceValue address={acct.address} />
        </Suspense>
      }
      viewerAccountId={acct.accountId}
      initialFeedPosts={feedPage.posts}
      initialFeedNextCursor={feedPage.nextCursor ?? null}
      library={library}
      followers={followers}
      following={following}
    />
  )
}
