export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/db'
import { getAuthedAccount } from '@/lib/authHelpers'
import { blockedAccountIds } from '@/lib/feedBlocks'
import { FEED_ACTION } from '@/lib/feedProtocol'

const TOP_LEVEL_ACTIONS = [FEED_ACTION.POST, FEED_ACTION.QUOTE]
// Client only ever needs to know "some" vs the exact count once it's large —
// cap the number shown so a long-idle tab doesn't read "1,482 new posts".
const COUNT_CAP = 50
// A blocked account's posts must never light up the "N new posts" banner —
// they're dropped from the feed the instant it loads, so counting them here
// would make the pill promise posts that never actually appear. That means
// this can't be a head:true exact count (nothing to filter on a bare count);
// fetch candidate author ids instead, bounded well above COUNT_CAP so a
// blocked account's own posting volume can't swallow real new posts out of
// the count (best-effort past this bound, matching the cap's existing spirit).
const CANDIDATE_LIMIT = COUNT_CAP * 6

/**
 * How many For You top-level posts exist newer than the caller's boundary
 * (the newest post they already have) — powers the "N new posts" banner.
 * Same candidate filter as getFeedPage's window (top-level actions, not deleted,
 * no mint cards), so the count agrees with what a refresh would add — EXCEPT it
 * excludes the viewer's OWN posts (your post already prepends to the top of your
 * feed the instant you make it, so it must never light the "new posts" pill) AND
 * posts from any account in a block relationship with the viewer, either
 * direction — those get dropped from the feed on load, so counting them here
 * would light the banner for posts that never actually appear when clicked.
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const createdAt = searchParams.get('t') || ''
  const id = searchParams.get('i') || ''
  if (!createdAt || !id) {
    return NextResponse.json({ error: 'Missing since boundary' }, { status: 400 })
  }

  // Best-effort: an anonymous viewer has no own-posts or blocks to exclude.
  const acct = await getAuthedAccount()

  const supabase = adminDb()
  let query = supabase
    .from('feed_posts')
    .select('author_account_id')
    .in('action', TOP_LEVEL_ACTIONS)
    .is('deleted_at', null)
    .or('card_kind.is.null,card_kind.eq.poll')
    .or(`created_at.gt.${createdAt},and(created_at.eq.${createdAt},id.gt.${id})`)
    .limit(CANDIDATE_LIMIT)
  if (acct?.accountId) query = query.neq('author_account_id', acct.accountId)

  const [{ data: rows, error }, blocked] = await Promise.all([
    query,
    acct?.accountId ? blockedAccountIds(supabase, acct.accountId) : Promise.resolve(new Set()),
  ])
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  const n = (rows ?? []).filter(
    (r) => !r.author_account_id || !blocked.has(r.author_account_id),
  ).length
  return NextResponse.json({ count: Math.min(n, COUNT_CAP), capped: n > COUNT_CAP })
}
