import { cache } from 'react'
import { createServerSupabase } from '@/lib/supabase-server'
import { isAudioStale } from '@/lib/audioConfig'
import { sumAmountRowsByPostId } from '@/lib/supabaseUnlockEarnings'
import { displayHandlesByAuthorId } from '@/lib/authorDisplayHandles'

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
      'id, author_id, title, teaser, body, audio_url, audio_char_count, audio_source_hash, price_xec, published, pinned, slug, created_at, published_at, reading_time_minutes, authors ( username, xec_address )',
    )
    .eq('slug', slug)
    .eq('published', true)
    .eq('legacy', false)
    .maybeSingle()

  if (postError || !postRow) return null

  const authorRel = postRow.authors
  const authorRowRaw = Array.isArray(authorRel) ? authorRel[0] : authorRel
  // Prefer the author's chosen handle (accounts.display_handle) for the byline,
  // falling back to authors.username when they haven't bound one.
  const handleMap = await displayHandlesByAuthorId([postRow.author_id], supabase)
  const authorRow = authorRowRaw
    ? { ...authorRowRaw, display_handle: handleMap[postRow.author_id] ?? null }
    : null
  const postIds = [postRow.id]
  const [unlockRes, commentRes, earnedRes] = await Promise.all([
    supabase.rpc('get_unlock_counts', { post_ids: postIds, since: null }),
    supabase.rpc('get_comment_counts', { post_ids: postIds }),
    supabase.rpc('get_unlock_earnings', { post_ids: postIds, since: null }),
  ])

  const earningsById = earnedRes.error ? {} : sumAmountRowsByPostId(earnedRes.data ?? [])

  const post = {
    ...postRow,
    audio_is_stale: isAudioStale(postRow.body, postRow.audio_source_hash),
    earnings: earningsById[postRow.id] ?? 0,
  }
  delete post.authors

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
