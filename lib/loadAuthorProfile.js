import { adminDb } from '@/lib/db'

function countRowsByPostId(rows) {
  const map = {}
  if (!Array.isArray(rows)) return map
  for (const r of rows) {
    if (r?.post_id == null) continue
    const n = typeof r.count === 'number' ? r.count : Number(r.count)
    map[r.post_id] = Number.isFinite(n) ? n : 0
  }
  return map
}

/** Map RPC `get_unlock_earnings` rows to post_id → sum(amount_xec). */
function sumAmountRowsByPostId(rows) {
  const map = {}
  if (!Array.isArray(rows)) return map
  for (const r of rows) {
    if (r?.post_id == null) continue
    const n =
      typeof r.total_amount === 'number' ? r.total_amount : Number(r.total_amount)
    map[r.post_id] = Number.isFinite(n) ? n : 0
  }
  return map
}

function mergeUnlockCommentAndEarnings(posts, unlockRows, commentRows, earningsRows) {
  const unlockById = countRowsByPostId(unlockRows)
  const commentById = countRowsByPostId(commentRows)
  const earningsById = sumAmountRowsByPostId(earningsRows)
  return (posts ?? []).map((p) => ({
    ...p,
    unlocks: [{ count: unlockById[p.id] ?? 0 }],
    comments: [{ count: commentById[p.id] ?? 0 }],
    earnings: earningsById[p.id] ?? 0,
  }))
}

// Columns a PROFILE render needs per article — no comment/earnings aggregates
// (the /@handle page shows neither; only readers, price, read-time). unlock_count
// is the denormalized reader tally maintained by sql/posts_unlock_count.sql.
const PROFILE_POST_COLUMNS =
  'id, title, slug, teaser, reading_time_minutes, price_xec, created_at, published_at, legacy, unlock_count'

/**
 * The article payload for the PUBLIC PROFILE page (/@handle), read straight from
 * the denormalized `posts.unlock_count` column — NO per-view aggregate RPCs. This
 * is what made a prolific author's profile slow: hydrateAuthorProfile ran three
 * GROUP BY RPCs (unlock/comment/earnings) over the author's whole catalogue, but
 * the profile only ever shows the READER count. So this loader does ONE indexed
 * query and shapes each row as the consumers already expect (`unlocks[0].count`).
 * hydrateAuthorProfile stays as-is for the dashboard / authors API, which do need
 * comments + earnings.
 *
 * @param {{ id: string }} author
 * @returns {Promise<{ error: string|null, posts: object[] }>}
 */
export async function loadProfileArticles(author) {
  if (!author?.id) return { error: 'invalid_author', posts: [] }

  const supabase = adminDb()
  const { data: postRows, error } = await supabase
    .from('posts')
    .select(PROFILE_POST_COLUMNS)
    .eq('author_id', author.id)
    .eq('published', true)
    .order('created_at', { ascending: false })

  if (error) return { error: error.message, posts: [] }

  // Chronology = when the piece WENT LIVE (published_at, falling back to
  // created_at) — same corrected sort hydrateAuthorProfile applies. Shape the
  // denormalized count into the `unlocks: [{ count }]` form AuthorFrontPage /
  // ArticleRow read, so the profile UI is untouched.
  const posts = (postRows ?? [])
    .sort(
      (a, b) =>
        new Date(b.published_at ?? b.created_at).getTime() -
        new Date(a.published_at ?? a.created_at).getTime(),
    )
    .map((p) => ({ ...p, unlocks: [{ count: p.unlock_count ?? 0 }] }))

  return { error: null, posts }
}

/**
 * Hydrate a KNOWN author into their public profile payload: published posts with
 * all-time unlock/comment counts and earnings, plus profile totals.
 *
 * This is the shared machinery. It takes an author row that some lookup already
 * resolved (by username, by handle, or by address) and does the identical
 * posts/stats assembly for all of them. Uses the service-role client; queries
 * still restrict to published rows.
 *
 * @param {{ id: string, username?: string, bio?: string|null, xec_address?: string|null }} author
 */
export async function hydrateAuthorProfile(author) {
  if (!author?.id) {
    return { error: 'invalid_author', author: null, posts: [], totalUnlocks: 0, totalEarnings: 0 }
  }

  const supabase = adminDb()

  const { data: postRows, error: postsError } = await supabase
    .from('posts')
    .select(
      'id, title, slug, teaser, reading_time_minutes, price_xec, created_at, published_at, legacy',
    )
    .eq('author_id', author.id)
    .eq('published', true)
    .order('created_at', { ascending: false })

  if (postsError) {
    return { error: postsError.message, author, posts: [], totalUnlocks: 0, totalEarnings: 0 }
  }

  // Chronology = when the piece WENT LIVE: paid-flow posts leave published_at
  // null (created_at is their real publication moment), while a long-drafted
  // post can go live months after created_at — e.g. a contest-winners post
  // drafted in April and published in July belongs at July. The DB can't
  // coalesce inside .order(), so sort here; every consumer of this list
  // (profile articles tab, /articles page) inherits the corrected order.
  const posts = (postRows ?? []).sort(
    (a, b) =>
      new Date(b.published_at ?? b.created_at).getTime() -
      new Date(a.published_at ?? a.created_at).getTime(),
  )
  const postIds = posts.map((p) => p.id).filter(Boolean)

  if (postIds.length === 0) {
    return { error: null, author, posts: [], totalUnlocks: 0, totalEarnings: 0 }
  }

  const [unlockRes, commentRes, earnedRes] = await Promise.all([
    supabase.rpc('get_unlock_counts', { post_ids: postIds, since: null }),
    supabase.rpc('get_comment_counts', { post_ids: postIds }),
    supabase.rpc('get_unlock_earnings', { post_ids: postIds, since: null }),
  ])

  if (unlockRes.error) {
    return { error: unlockRes.error.message, author, posts, totalUnlocks: 0, totalEarnings: 0 }
  }
  if (commentRes.error) {
    return { error: commentRes.error.message, author, posts, totalUnlocks: 0, totalEarnings: 0 }
  }
  if (earnedRes.error) {
    return { error: earnedRes.error.message, author, posts, totalUnlocks: 0, totalEarnings: 0 }
  }

  const merged = mergeUnlockCommentAndEarnings(
    posts,
    unlockRes.data ?? [],
    commentRes.data ?? [],
    earnedRes.data ?? [],
  )

  const totalUnlocks = merged.reduce(
    (sum, p) => sum + (p.unlocks?.[0]?.count ?? 0),
    0,
  )
  const totalEarnings = merged.reduce((sum, p) => {
    const n = Number(p.earnings)
    return sum + (Number.isFinite(n) ? n : 0)
  }, 0)

  return { error: null, author, posts: merged, totalUnlocks, totalEarnings }
}

/**
 * Public author profile by username (legacy /u/[username] path).
 * Now a thin wrapper: look up the author row, then hand off to the shared
 * hydrator. Behaviour is identical to before the refactor.
 */
export async function loadAuthorProfileByUsername(rawUsername) {
  const username =
    typeof rawUsername === 'string' ? decodeURIComponent(rawUsername.trim()) : ''
  if (!username) {
    return {
      error: 'invalid_username',
      author: null,
      posts: [],
      totalUnlocks: 0,
      totalEarnings: 0,
    }
  }

  const supabase = adminDb()

  const { data: author, error: authorError } = await supabase
    .from('authors')
    .select('id, username, bio, xec_address')
    .eq('username', username)
    .maybeSingle()

  if (authorError) {
    return {
      error: authorError.message,
      author: null,
      posts: [],
      totalUnlocks: 0,
      totalEarnings: 0,
    }
  }
  if (!author) {
    return { error: null, author: null, posts: [], totalUnlocks: 0, totalEarnings: 0 }
  }

  return hydrateAuthorProfile(author)
}
