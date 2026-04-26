import { createSupabaseAdminClient } from './supabase-admin'

const PAGE_SIZE = 25

function parseSearchQuery(query) {
  const trimmed = typeof query === 'string' ? query.trim() : ''
  if (!trimmed) return []

  const terms = []
  const regex = /"([^"]+)"|(\S+)/g
  let match
  while ((match = regex.exec(trimmed)) !== null) {
    const term = (match[1] || match[2] || '').trim()
    if (term) terms.push(term)
  }
  return terms
}

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
  const terms = parseSearchQuery(query)
  if (terms.length === 0) {
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

  let countQuery = supabase
    .from('posts')
    .select('id', { count: 'exact', head: true })
    .eq('published', true)

  for (const term of terms) {
    const escaped = term.replace(/[%_]/g, '\\$&')
    const pattern = `%${escaped}%`
    countQuery = countQuery.or(`title.ilike.${pattern},teaser.ilike.${pattern}`)
  }

  const { count, error: countError } = await countQuery

  if (countError) {
    console.error('[searchPosts] count error', countError)
    return { posts: [], hasNextPage: false, total: 0 }
  }

  let pageQuery = supabase
    .from('posts')
    .select(
      'id, title, slug, teaser, reading_time_minutes, price_xec, created_at, published_at, author_id, audio_url, authors(username)',
    )
    .eq('published', true)

  for (const term of terms) {
    const escaped = term.replace(/[%_]/g, '\\$&')
    const pattern = `%${escaped}%`
    pageQuery = pageQuery.or(`title.ilike.${pattern},teaser.ilike.${pattern}`)
  }

  const { data: rows, error } = await pageQuery
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
