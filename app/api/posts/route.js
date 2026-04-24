export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { createServerSupabase } from '@/lib/supabase-server'

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

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const sortMode = searchParams.get('sort') ?? 'unlocks'
  const timeFilter = searchParams.get('timeFilter') ?? 'all'
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const start = (page - 1) * PAGE_SIZE
  const end = start + PAGE_SIZE - 1

  const followingOnly = searchParams.get('followingOnly') === 'true'
  const walletAddress = (searchParams.get('walletAddress') ?? '').trim()

  let followedAuthorIds = null
  if (followingOnly && walletAddress) {
    const admin = createSupabaseAdminClient()
    if (!admin) {
      return NextResponse.json(
        { error: 'Server configuration error: missing Supabase admin credentials' },
        { status: 500 },
      )
    }
    const { data: followRows, error: followError } = await admin
      .from('follows')
      .select('author_id')
      .eq('reader_wallet_address', walletAddress)

    if (followError) {
      return NextResponse.json({ error: followError.message }, { status: 500 })
    }

    const uniqueIds = [
      ...new Set((followRows ?? []).map((r) => r.author_id).filter(Boolean)),
    ]
    if (uniqueIds.length === 0) {
      return NextResponse.json({ posts: [], hasNextPage: false })
    }
    followedAuthorIds = uniqueIds
  }

  const supabase = createServerSupabase()

  // ── NEWEST sort: simple paginated query + parallel count RPCs ──
  if (sortMode === 'newest') {
    let newestQuery = supabase
      .from('posts')
      .select('id, title, slug, teaser, reading_time_minutes, price_xec, created_at, published_at, author_id, authors(username)')
      .eq('published', true)
      .eq('legacy', false)

    if (followedAuthorIds) {
      newestQuery = newestQuery.in('author_id', followedAuthorIds)
    }

    const { data: rows, error } = await newestQuery
      .order('published_at', { ascending: false, nullsFirst: false })
      .range(start, end)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
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

    return NextResponse.json(
      { posts, hasNextPage: (rows ?? []).length === PAGE_SIZE },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      },
    )
  }

  // ── UNLOCKS or EARNED sort: fetch all IDs + aggregates, sort, then fetch page ──
  const earnedSort = sortMode === 'earned'
  const since = getSinceTimestamp(timeFilter)

  // Step 1: all published post IDs + created_at for tiebreaking
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
    return NextResponse.json({ error: idError.message }, { status: 500 })
  }

  const allMeta = idRows ?? []
  if (allMeta.length === 0) {
    return NextResponse.json({ posts: [], hasNextPage: false })
  }

  const allIds = allMeta.map((r) => r.id).filter(Boolean)
  const sortTimeById = Object.fromEntries(
    allMeta.map((r) => [
      r.id,
      new Date(r.published_at ?? r.created_at).getTime(),
    ]),
  )

  // Step 2: aggregates for all posts (earned = SUM amount_xec; unlocks = COUNT)
  let sortKeyById = {}
  let unlockCountById = {}

  if (earnedSort) {
    const [earnedRes, countRes] = await Promise.all([
      supabase.rpc('get_unlock_earnings', { post_ids: allIds, since }),
      supabase.rpc('get_unlock_counts', { post_ids: allIds, since }),
    ])
    if (earnedRes.error) {
      return NextResponse.json({ error: earnedRes.error.message }, { status: 500 })
    }
    if (countRes.error) {
      return NextResponse.json({ error: countRes.error.message }, { status: 500 })
    }
    sortKeyById = sumAmountRowsByPostId(earnedRes.data ?? [])
    unlockCountById = countRowsByPostId(countRes.data ?? [])
  } else {
    const { data: unlockRowsAll, error: unlockError } = await supabase.rpc(
      'get_unlock_counts',
      { post_ids: allIds, since },
    )
    if (unlockError) {
      return NextResponse.json({ error: unlockError.message }, { status: 500 })
    }
    unlockCountById = countRowsByPostId(unlockRowsAll ?? [])
    sortKeyById = unlockCountById
  }

  // Step 3: sort IDs with non-zero metric first, then zero-metric newest-first.
  const sortedIds = sortIdsWithZeroTail(allIds, sortKeyById, sortTimeById)

  const pageIds = sortedIds.slice(start, start + PAGE_SIZE)
  const hasNextPage = start + PAGE_SIZE < sortedIds.length

  if (pageIds.length === 0) {
    return NextResponse.json({ posts: [], hasNextPage: false })
  }

  // Step 4: fetch full post rows + comment counts in parallel
  const [pageRes, commentRes] = await Promise.all([
    supabase
      .from('posts')
      .select('id, title, slug, teaser, reading_time_minutes, price_xec, created_at, published_at, author_id, authors(username)')
      .eq('legacy', false)
      .in('id', pageIds),
    supabase.rpc('get_comment_counts', { post_ids: pageIds }),
  ])

  if (pageRes.error) {
    return NextResponse.json({ error: pageRes.error.message }, { status: 500 })
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
          /** Sum of `unlocks.amount_xec` (satoshis) across all unlocks for this post. */
          earnings: sortKeyById[p.id] ?? 0,
        }
      }
      return row
    })

  return NextResponse.json(
    { posts, hasNextPage },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  )
}
