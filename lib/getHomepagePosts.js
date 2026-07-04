import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { createServerSupabase } from '@/lib/supabase-server'
import { displayHandlesByAuthorId } from '@/lib/authorDisplayHandles'

/**
 * Tag each post (and the pinned post) with the author's chosen display handle
 * so feed bylines show "@handle" instead of "@username" when one is bound.
 */
async function attachHomepageHandles(supabase, result) {
  const ids = new Set()
  if (result.pinnedPost?.author_id) ids.add(result.pinnedPost.author_id)
  for (const p of result.posts ?? []) if (p?.author_id) ids.add(p.author_id)
  if (ids.size === 0) return result

  const map = await displayHandlesByAuthorId(Array.from(ids), supabase)
  const tag = (p) => (p ? { ...p, display_handle: map[p.author_id] ?? null } : p)
  return {
    ...result,
    pinnedPost: tag(result.pinnedPost),
    posts: (result.posts ?? []).map(tag),
  }
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

/**
 * Loads the single published pinned post (if any) and shapes it like homepage list rows.
 * `since` is only used for the earnings sort key on `earned`; `unlockCount` is always all-time.
 */
async function fetchPinnedHomePost(supabase, { since, earnedSort, followedAuthorIds }) {
  let q = supabase
    .from('posts')
    .select(
      'id, title, slug, teaser, reading_time_minutes, price_xec, created_at, published_at, author_id, audio_url, authors(username)',
    )
    .eq('published', true)
    .eq('legacy', false)
    .eq('pinned', true)
    .limit(1)

  if (followedAuthorIds) {
    q = q.in('author_id', followedAuthorIds)
  }

  const { data: row, error } = await q.maybeSingle()
  if (error) {
    throw new Error(error.message)
  }
  if (!row?.id) return null

  const postId = row.id
  const [unlockRes, commentRes] = await Promise.all([
    supabase.rpc('get_unlock_counts', { post_ids: [postId], since: null }),
    supabase.rpc('get_comment_counts', { post_ids: [postId] }),
  ])
  if (unlockRes.error) {
    throw new Error(unlockRes.error.message)
  }
  if (commentRes.error) {
    throw new Error(commentRes.error.message)
  }

  const unlockById = countRowsByPostId(unlockRes.data ?? [])
  const commentById = countRowsByPostId(commentRes.data ?? [])
  const base = {
    ...row,
    unlockCount: unlockById[postId] ?? 0,
    commentCount: commentById[postId] ?? 0,
  }

  if (earnedSort) {
    const { data: earnedRows, error: earnedError } = await supabase.rpc('get_unlock_earnings', {
      post_ids: [postId],
      since,
    })
    if (earnedError) {
      throw new Error(earnedError.message)
    }
    const earningsById = sumAmountRowsByPostId(earnedRows ?? [])
    return {
      ...base,
      earnings: earningsById[postId] ?? 0,
    }
  }

  return base
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
      return { pinnedPost: null, posts: [], hasNextPage: false }
    }
    followedAuthorIds = uniqueIds
  }

  const supabase = createServerSupabase()

  const earnedSort = sortMode === 'earned'
  const sinceForPinned =
    sortMode === 'newest' ? null : getSinceTimestamp(timeFilter)

  const pinnedPost = await fetchPinnedHomePost(supabase, {
    since: sinceForPinned,
    earnedSort,
    followedAuthorIds,
  })
  const pinnedId = pinnedPost?.id ?? null

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

    const rowsFiltered = pinnedId
      ? (rows ?? []).filter((p) => p?.id && p.id !== pinnedId)
      : rows ?? []

    const postIds = rowsFiltered.map((p) => p.id).filter(Boolean)
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
    const posts = rowsFiltered.map((p) => ({
      ...p,
      unlockCount: unlockById[p.id] ?? 0,
      commentCount: commentById[p.id] ?? 0,
    }))

    return await attachHomepageHandles(supabase, {
      pinnedPost,
      posts,
      hasNextPage: (rows ?? []).length === pageSizeNum,
    })
  }

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

  const allMeta = (idRows ?? []).filter((r) => r?.id && (!pinnedId || r.id !== pinnedId))
  if (allMeta.length === 0) {
    return await attachHomepageHandles(supabase, { pinnedPost, posts: [], hasNextPage: false })
  }

  const allIds = allMeta.map((r) => r.id).filter(Boolean)
  const sortTimeById = Object.fromEntries(
    allMeta.map((r) => [
      r.id,
      new Date(r.published_at ?? r.created_at).getTime(),
    ]),
  )

  let sortKeyById = {}

  if (earnedSort) {
    const { data: earnedRows, error: earnedError } = await supabase.rpc(
      'get_unlock_earnings',
      { post_ids: allIds, since },
    )
    if (earnedError) {
      throw new Error(earnedError.message)
    }
    sortKeyById = sumAmountRowsByPostId(earnedRows ?? [])
  } else {
    const { data: windowedCountRows, error: windowedCountError } = await supabase.rpc(
      'get_unlock_counts',
      { post_ids: allIds, since },
    )
    if (windowedCountError) {
      throw new Error(windowedCountError.message)
    }
    sortKeyById = countRowsByPostId(windowedCountRows ?? [])
  }

  const sortedIds = sortIdsWithZeroTail(allIds, sortKeyById, sortTimeById)

  const pageIds = sortedIds.slice(start, start + pageSizeNum)
  const hasNextPage = start + pageSizeNum < sortedIds.length

  if (pageIds.length === 0) {
    return await attachHomepageHandles(supabase, { pinnedPost, posts: [], hasNextPage: false })
  }

  const [pageRes, commentRes, allTimeUnlockRes] = await Promise.all([
    supabase
      .from('posts')
      .select('id, title, slug, teaser, reading_time_minutes, price_xec, created_at, published_at, author_id, audio_url, authors(username)')
      .eq('legacy', false)
      .in('id', pageIds),
    supabase.rpc('get_comment_counts', { post_ids: pageIds }),
    supabase.rpc('get_unlock_counts', { post_ids: pageIds, since: null }),
  ])

  if (pageRes.error) {
    throw new Error(pageRes.error.message)
  }
  if (allTimeUnlockRes.error) {
    throw new Error(allTimeUnlockRes.error.message)
  }

  const commentById = countRowsByPostId(commentRes.data ?? [])
  const allTimeUnlockById = countRowsByPostId(allTimeUnlockRes.data ?? [])
  const orderIndex = new Map(pageIds.map((id, i) => [id, i]))
  const posts = (pageRes.data ?? [])
    .filter((p) => p?.id != null)
    .sort((a, b) => orderIndex.get(a.id) - orderIndex.get(b.id))
    .map((p) => {
      const row = {
        ...p,
        unlockCount: allTimeUnlockById[p.id] ?? 0,
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

  return await attachHomepageHandles(supabase, { pinnedPost, posts, hasNextPage })
}
