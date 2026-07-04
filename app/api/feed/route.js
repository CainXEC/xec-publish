export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { getFeedPage } from '@/lib/getFeed'

/** Paginated newest-first feed of top-level posts (for client refresh / infinite scroll). */
export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const page = Number(searchParams.get('page')) || 1
  try {
    const { posts, hasNextPage } = await getFeedPage({ page })
    return NextResponse.json({ posts, hasNextPage })
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Failed to load feed' }, { status: 500 })
  }
}
