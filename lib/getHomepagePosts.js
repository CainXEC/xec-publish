import { createSupabaseAdminClient } from '@/lib/supabase-admin'
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

function getSinceTimestamp(timeFilter) {
  if (!timeFilter || timeFilter === 'all') return null
  const now = new Date()
  if (timeFilter === '24h') now.setHours(now.getHours() - 24)
  if (timeFilter === '7d') now.setDate(now.getDate() - 7)
  if (timeFilter === '30d') now.setDate(now.getDate() - 30)
  if (timeFilter === '1y') now.setFullYear(now.getFullYear() - 1)
  return now.toISOString()
}

function sortIdsWithZeroTail(ids, metricById, sortTimeById) {
  const withMetric = ids.filter((id) => (metricById[id] ?? 0) > 0)
  const withoutMetric = ids.filter((id) => (metricById[id] ?? 0) <= 0)

  withMetric.sort((a, b) => {
    const diff = (metricById[b] ?? 0) - (metricById[a] ?? 0)
    if (diff !== 0) return diff
    return (sortTimeById[b] ?? 0) - (sortTimeById[a] ?? 0)
  })

  withoutMetric.sort((a, b) => (sortTimeById[b] ?? 0) - (sortTimeById[a] ?? 0))

  return [...withMetric, ...withoutMetric]
}

export async function getHomepagePosts({
  sort = 'earned',
  timeFilter = '24h',
  page = 1,
  pageSize = 25,
  followingOnly = false,
  walletAddress = '',
}) {
  const sortMode = sort ?? 'earned'
  const pageNum = Math.max(1, Number(page) || 1)
  const pageSizeNum = Math.max(1, Number(pageSize) || 25)
  const start = (pageNum - 1) * pageSizeNum
  const end = start + pageSizeNum - 1

  let followedAuthorIds = null
  if (followingOnly && walletAddress) {
    const admin = createSupabaseAdminClient()
    if (!admin) {
      throw new Error('Server configuration error: missing Supabase admin credentials')
    }
    const { data: followRows, error: followError } = await admin
      .from('follows')
      .select('author_id')
      .eq('reader_wallet_address', walletAddress)

    if (followError) {
      throw new Error(followError.message)
    }

    const uniqueIds = [
      ...new Set((followRows ?? []).map((r) => r.author_id).filter(Boolean)),
    ]
    if (uniqueIds.length === 0) {
      return { posts: [], hasNextPage: false }
    }
    followedAuthorIds = uniqueIds
  }

  const supabase = createServerSupabase()

  if (sortMode === 'newest') {
    let newestQuery = supabase
      .from('posts')
      .select('id, title, slug, teaser, reading_time_minutes, price_xec, created_at, published_at, author_id, audio_url, authors(username)')
      .eq('published', true)
      .eq('legacy', false)

    if (followedAuthorIds) {
      newestQuery = newestQuery.in('author_id', followedAuthorIds)
    }

    const { data: rows, error } = await newestQuery
      .order('published_at', { ascending: false, nullsFirst: false })
      .range(start, end)

    if (error) {
      throw new Error(error.message)
    }

    const postIds = (rows ?? []).map((p) => p.id).filter(Boolean)
    let unlockCounts = []
    let commentCounts = []

    if (postIds.length > 0) {
      const [unlockRes, commentRes] = await Promise.all([
        supabase.rpc('get_unlock_counts', { post_ids: postIds, since: null }),
        supabase.rpc('get_comment_counts', { post_ids: postIds }),
      ])
      unlockCounts = unlockRes.data ?? []
      commentCounts = commentRes.data ?? []
    }

    const unlockById = countRowsByPostId(unlockCounts)
    const commentById = countRowsByPostId(commentCounts)
    const posts = (rows ?? []).map((p) => ({
      ...p,
      unlockCount: unlockById[p.id] ?? 0,
      commentCount: commentById[p.id] ?? 0,
    }))

    return { posts, hasNextPage: (rows ?? []).length === pageSizeNum }
  }

  const earnedSort = sortMode === 'earned'
  const since = getSinceTimestamp(timeFilter)

  let idQuery = supabase
    .from('posts')
    .select('id, created_at, published_at')
    .eq('published', true)
    .eq('legacy', false)

  if (followedAuthorIds) {
    idQuery = idQuery.in('author_id', followedAuthorIds)
  }
  const { data: idRows, error: idError } = await idQuery

  if (idError) {
    throw new Error(idError.message)
  }

  const allMeta = idRows ?? []
  if (allMeta.length === 0) {
    return { posts: [], hasNextPage: false }
  }

  const allIds = allMeta.map((r) => r.id).filter(Boolean)
  const sortTimeById = Object.fromEntries(
    allMeta.map((r) => [
      r.id,
      new Date(r.published_at ?? r.created_at).getTime(),
    ]),
  )

  let sortKeyById = {}
  let unlockCountById = {}

  if (earnedSort) {
    const [earnedRes, countRes] = await Promise.all([
      supabase.rpc('get_unlock_earnings', { post_ids: allIds, since }),
      supabase.rpc('get_unlock_counts', { post_ids: allIds, since }),
    ])
    if (earnedRes.error) {
      throw new Error(earnedRes.error.message)
    }
    if (countRes.error) {
      throw new Error(countRes.error.message)
    }
    sortKeyById = sumAmountRowsByPostId(earnedRes.data ?? [])
    unlockCountById = countRowsByPostId(countRes.data ?? [])
  } else {
    const { data: unlockRowsAll, error: unlockError } = await supabase.rpc(
      'get_unlock_counts',
      { post_ids: allIds, since },
    )
    if (unlockError) {
      throw new Error(unlockError.message)
    }
    unlockCountById = countRowsByPostId(unlockRowsAll ?? [])
    sortKeyById = unlockCountById
  }

  const sortedIds = sortIdsWithZeroTail(allIds, sortKeyById, sortTimeById)

  const pageIds = sortedIds.slice(start, start + pageSizeNum)
  const hasNextPage = start + pageSizeNum < sortedIds.length

  if (pageIds.length === 0) {
    return { posts: [], hasNextPage: false }
  }

  const [pageRes, commentRes] = await Promise.all([
    supabase
      .from('posts')
      .select('id, title, slug, teaser, reading_time_minutes, price_xec, created_at, published_at, author_id, audio_url, authors(username)')
      .eq('legacy', false)
      .in('id', pageIds),
    supabase.rpc('get_comment_counts', { post_ids: pageIds }),
  ])

  if (pageRes.error) {
    throw new Error(pageRes.error.message)
  }

  const commentById = countRowsByPostId(commentRes.data ?? [])
  const orderIndex = new Map(pageIds.map((id, i) => [id, i]))
  const posts = (pageRes.data ?? [])
    .filter((p) => p?.id != null)
    .sort((a, b) => orderIndex.get(a.id) - orderIndex.get(b.id))
    .map((p) => {
      const row = {
        ...p,
        unlockCount: unlockCountById[p.id] ?? 0,
        commentCount: commentById[p.id] ?? 0,
      }
      if (earnedSort) {
        return {
          ...row,
          earnings: sortKeyById[p.id] ?? 0,
        }
      }
      return row
    })

  return { posts, hasNextPage }
}
