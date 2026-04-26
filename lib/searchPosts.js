import { createSupabaseAdminClient } from './supabase-admin'

const PAGE_SIZE = 25

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

export async function searchPosts({ query, page = 1, pageSize = PAGE_SIZE }) {
  const trimmed = typeof query === 'string' ? query.trim() : ''
  if (!trimmed) {
    return { posts: [], hasNextPage: false, total: 0 }
  }

  const supabase = createSupabaseAdminClient()
  if (!supabase) {
    return { posts: [], hasNextPage: false, total: 0 }
  }

  const pageNum = Number.isFinite(Number(page))
    ? Math.max(1, Math.floor(Number(page)))
    : 1
  const sizeNum = Number.isFinite(Number(pageSize))
    ? Math.max(1, Math.floor(Number(pageSize)))
    : PAGE_SIZE
  const offset = (pageNum - 1) * sizeNum

  const escaped = trimmed.replace(/[%_]/g, '\\$&')
  const pattern = `%${escaped}%`
  const clause = `title.ilike.${pattern},teaser.ilike.${pattern}`

  const { count, error: countError } = await supabase
    .from('posts')
    .select('id', { count: 'exact', head: true })
    .eq('published', true)
    .or(clause)

  if (countError) {
    console.error('[searchPosts] count error', countError)
    return { posts: [], hasNextPage: false, total: 0 }
  }

  const { data: rows, error } = await supabase
    .from('posts')
    .select(
      'id, title, slug, teaser, reading_time_minutes, price_xec, created_at, published_at, author_id, audio_url, authors(username)',
    )
    .eq('published', true)
    .or(clause)
    .order('published_at', { ascending: false, nullsFirst: false })
    .range(offset, offset + sizeNum - 1)

  if (error) {
    console.error('[searchPosts] query error', error)
    return { posts: [], hasNextPage: false, total: 0 }
  }

  const posts = rows ?? []
  const postIds = posts.map((p) => p.id).filter(Boolean)
  let unlockById = {}
  let commentById = {}

  if (postIds.length > 0) {
    const [unlockRes, commentRes] = await Promise.all([
      supabase.rpc('get_unlock_counts', { post_ids: postIds, since: null }),
      supabase.rpc('get_comment_counts', { post_ids: postIds }),
    ])
    unlockById = unlockRes.error ? {} : countRowsByPostId(unlockRes.data ?? [])
    commentById = commentRes.error ? {} : countRowsByPostId(commentRes.data ?? [])
  }

  return {
    posts: posts.map((p) => ({
      ...p,
      unlockCount: unlockById[p.id] ?? 0,
      commentCount: commentById[p.id] ?? 0,
    })),
    hasNextPage: Number(count ?? 0) > offset + sizeNum,
    total: count ?? 0,
  }
}
