import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'

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
  const timeFilter = searchParams.get('timeFilter') ?? 'all'
  const since = getSinceTimestamp(timeFilter)
  const sortBy = searchParams.get('sortBy') ?? 'unlocks'

  const supabase = createServerSupabase()
  const { data, error } = await supabase.rpc('get_leaderboard', { since, sort_by: sortBy })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = (data ?? []).map((r) => ({
    author_id: r.author_id,
    username: String(r.username ?? '').trim() || 'unknown',
    post_count: Number(r.post_count) || 0,
    total_unlocks: Number(r.total_unlocks) || 0,
    total_xec: Number(r.total_xec) || 0,
  })).slice(0, 10)

  return NextResponse.json(
    { rows },
    {
      headers: {
        'Cache-Control': 's-maxage=30, stale-while-revalidate=300',
      },
    },
  )
}
