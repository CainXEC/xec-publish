import { createServerSupabase } from '@/lib/supabase-server'

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

/**
 * Public author profile: one author row + published posts with all-time unlock/comment counts.
 * Uses service-role client (same as /api/posts); queries still restrict to published rows.
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

  const supabase = createServerSupabase()

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

  const { data: postRows, error: postsError } = await supabase
    .from('posts')
    .select(
      'id, title, slug, teaser, reading_time_minutes, price_xec, created_at, published_at, legacy, audio_url',
    )
    .eq('author_id', author.id)
    .eq('published', true)
    .order('created_at', { ascending: false })

  if (postsError) {
    return { error: postsError.message, author, posts: [], totalUnlocks: 0, totalEarnings: 0 }
  }

  const posts = postRows ?? []
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
