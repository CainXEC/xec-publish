export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { getHomepagePosts } from '@/lib/getHomepagePosts'

const PAGE_SIZE = 25

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const sortMode = searchParams.get('sort') ?? 'unlocks'
  const timeFilter = searchParams.get('timeFilter') ?? 'all'
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))

  const followingOnly = searchParams.get('followingOnly') === 'true'
  const walletAddress = (searchParams.get('walletAddress') ?? '').trim()
  try {
    const result = await getHomepagePosts({
      sort: sortMode,
      timeFilter,
      page,
      pageSize: PAGE_SIZE,
      followingOnly,
      walletAddress,
    })
    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    return NextResponse.json(
      { error: err?.message || 'Failed to fetch posts' },
      { status: 500 },
    )
  }
}
