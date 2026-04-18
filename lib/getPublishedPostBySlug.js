import { cache } from 'react'
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

/**
 * Cached per request — shared by `generateMetadata` and the post page to avoid duplicate queries.
 */
export const getPublishedPostBySlug = cache(async (rawSlug) => {
  const slug =
    typeof rawSlug === 'string' ? decodeURIComponent(rawSlug.trim()) : ''
  if (!slug) return null

  const supabase = createServerSupabase()

  const { data: postRow, error: postError } = await supabase
    .from('posts')
    .select(
      'id, author_id, title, teaser, body, price_xec, published, slug, created_at, published_at, reading_time_minutes, authors ( username, xec_address )',
    )
    .eq('slug', slug)
    .eq('published', true)
    .maybeSingle()

  if (postError || !postRow) return null

  const authorRel = postRow.authors
  const authorRow = Array.isArray(authorRel) ? authorRel[0] : authorRel
  const post = { ...postRow }
  delete post.authors

  const postIds = [post.id]
  const [unlockRes, commentRes] = await Promise.all([
    supabase.rpc('get_unlock_counts', { post_ids: postIds, since: null }),
    supabase.rpc('get_comment_counts', { post_ids: postIds }),
  ])

  const unlockById = unlockRes.error
    ? {}
    : countRowsByPostId(unlockRes.data ?? [])
  const commentById = commentRes.error
    ? {}
    : countRowsByPostId(commentRes.data ?? [])

  return {
    post,
    author: authorRow ?? null,
    unlockCount: unlockById[post.id] ?? 0,
    commentCount: commentById[post.id] ?? 0,
  }
})
