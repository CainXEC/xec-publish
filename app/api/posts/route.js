import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'

const PAGE_SIZE = 10

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

function getSinceTimestamp(timeFilter) {
  if (!timeFilter || timeFilter === 'all') return null
  const now = new Date()
  if (timeFilter === '24h') now.setHours(now.getHours() - 24)
  if (timeFilter === '7d') now.setDate(now.getDate() - 7)
  if (timeFilter === '30d') now.setDate(now.getDate() - 30)
  if (timeFilter === '1y') now.setFullYear(now.getFullYear() - 1)
  return now.toISOString()
}

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const sortMode = searchParams.get('sort') ?? 'unlocks'
  const timeFilter = searchParams.get('timeFilter') ?? 'all'
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const start = (page - 1) * PAGE_SIZE
  const end = start + PAGE_SIZE - 1

  const supabase = createServerSupabase()

  // ── NEWEST sort: simple paginated query + parallel count RPCs ──
  if (sortMode === 'newest') {
    const { data: rows, error } = await supabase
      .from('posts')
      .select('id, title, slug, teaser, reading_time_minutes, price_xec, created_at, published_at, author_id, authors(username)')
      .eq('published', true)
      .order('created_at', { ascending: false })
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
          // Cache at the CDN edge for 30s, serve stale for up to 5min while revalidating
          'Cache-Control': 's-maxage=30, stale-while-revalidate=300',
        },
      },
    )
  }

  // ── UNLOCKS sort: fetch all IDs + unlock counts, sort, then fetch page ──
  const since = getSinceTimestamp(timeFilter)

  // Step 1: all published post IDs + created_at for tiebreaking
  const { data: idRows, error: idError } = await supabase
    .from('posts')
    .select('id, created_at, published_at')
    .eq('published', true)

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

  // Step 2: unlock counts for all posts (parallel with comment counts for page later)
  const { data: unlockRowsAll, error: unlockError } = await supabase.rpc(
    'get_unlock_counts',
    { post_ids: allIds, since },
  )

  if (unlockError) {
    return NextResponse.json({ error: unlockError.message }, { status: 500 })
  }

  // Step 3: sort all IDs by unlock count desc, then newest first
  const countById = countRowsByPostId(unlockRowsAll ?? [])
  const sortedIds = [...allIds].sort((a, b) => {
    const diff = (countById[b] ?? 0) - (countById[a] ?? 0)
    if (diff !== 0) return diff
    return (sortTimeById[b] ?? 0) - (sortTimeById[a] ?? 0)
  })

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
    .map((p) => ({
      ...p,
      unlockCount: countById[p.id] ?? 0,
      commentCount: commentById[p.id] ?? 0,
    }))

  return NextResponse.json(
    { posts, hasNextPage },
    {
      headers: {
        'Cache-Control': 's-maxage=30, stale-while-revalidate=300',
      },
    },
  )
}
