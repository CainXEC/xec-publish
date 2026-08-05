export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/db'
import { FEED_ACTION } from '@/lib/feedProtocol'

const TOP_LEVEL_ACTIONS = [FEED_ACTION.POST, FEED_ACTION.QUOTE]
// Client only ever needs to know "some" vs the exact count once it's large —
// cap the number shown so a long-idle tab doesn't read "1,482 new posts".
const COUNT_CAP = 50

/**
 * How many For You top-level posts exist newer than the caller's boundary
 * (the newest post they already have) — powers the "N new posts" banner.
 * Viewer-neutral, same candidate filter as getFeedPage's window (top-level
 * actions, not deleted, no mint cards), so the count agrees with what a
 * refresh would actually add.
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const createdAt = searchParams.get('t') || ''
  const id = searchParams.get('i') || ''
  if (!createdAt || !id) {
    return NextResponse.json({ error: 'Missing since boundary' }, { status: 400 })
  }

  const supabase = adminDb()
  const { count, error } = await supabase
    .from('feed_posts')
    .select('id', { count: 'exact', head: true })
    .in('action', TOP_LEVEL_ACTIONS)
    .is('deleted_at', null)
    .or('card_kind.is.null,card_kind.eq.poll')
    .or(`created_at.gt.${createdAt},and(created_at.eq.${createdAt},id.gt.${id})`)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  const n = count ?? 0
  return NextResponse.json({ count: Math.min(n, COUNT_CAP), capped: n > COUNT_CAP })
}
