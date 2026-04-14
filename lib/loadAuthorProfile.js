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

function mergeUnlockAndCommentCounts(posts, unlockRows, commentRows) {
  const unlockById = countRowsByPostId(unlockRows)
  const commentById = countRowsByPostId(commentRows)
  return (posts ?? []).map((p) => ({
    ...p,
    unlocks: [{ count: unlockById[p.id] ?? 0 }],
    comments: [{ count: commentById[p.id] ?? 0 }],
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
    return { error: 'invalid_username', author: null, posts: [] }
  }

  const supabase = createServerSupabase()

  const { data: author, error: authorError } = await supabase
    .from('authors')
    .select('id, username, bio, xec_address')
    .eq('username', username)
    .maybeSingle()

  if (authorError) {
    return { error: authorError.message, author: null, posts: [] }
  }
  if (!author) {
    return { error: null, author: null, posts: [] }
  }

  const { data: postRows, error: postsError } = await supabase
    .from('posts')
    .select('id, title, slug, teaser, reading_time_minutes, price_xec, created_at')
    .eq('author_id', author.id)
    .eq('published', true)
    .order('created_at', { ascending: false })

  if (postsError) {
    return { error: postsError.message, author, posts: [] }
  }

  const posts = postRows ?? []
  const postIds = posts.map((p) => p.id).filter(Boolean)

  if (postIds.length === 0) {
    return { error: null, author, posts: [] }
  }

  const [unlockRes, commentRes] = await Promise.all([
    supabase.rpc('get_unlock_counts', { post_ids: postIds, since: null }),
    supabase.rpc('get_comment_counts', { post_ids: postIds }),
  ])

  if (unlockRes.error) {
    return { error: unlockRes.error.message, author, posts }
  }
  if (commentRes.error) {
    return { error: commentRes.error.message, author, posts }
  }

  const merged = mergeUnlockAndCommentCounts(
    posts,
    unlockRes.data ?? [],
    commentRes.data ?? [],
  )

  return { error: null, author, posts: merged }
}
