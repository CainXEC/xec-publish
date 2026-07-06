export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { getAuthedAccount } from '@/lib/authHelpers'
import { FEED_ACTION } from '@/lib/feedProtocol'
import { blockedAccountIds } from '@/lib/feedBlocks'

const MAX_IDS = 100

function cleanIds(value) {
  if (!Array.isArray(value)) return []
  return value.filter((v) => typeof v === 'string' && v.length > 0).slice(0, MAX_IDS)
}

/**
 * Per-viewer personalization overlay for the shared, cached For You feed. The
 * feed payload itself is viewer-neutral (same cached copy for everyone); this
 * endpoint resolves the ONE viewer-specific slice — which of the given posts the
 * signed-in wallet has liked/reposted, which of the given authors it follows, and
 * which are blocked — so the client can fill in the like/repost/Follow states and
 * drop blocked authors after the feed paints. Not signed in → empty sets.
 */
export async function POST(request) {
  let body
  try {
    body = await request.json()
  } catch {
    body = {}
  }
  const txids = cleanIds(body?.txids)
  const authorIds = cleanIds(body?.authorIds)

  const empty = { liked: [], reposted: [], followed: [], blocked: [] }
  const acct = await getAuthedAccount()
  if (!acct) return NextResponse.json(empty)

  const supabase = createServerSupabase()

  const liked = []
  const reposted = []
  if (txids.length > 0 && acct.address) {
    const { data } = await supabase
      .from('feed_events')
      .select('target_txid, action')
      .eq('payer_address', acct.address)
      .in('target_txid', txids)
    for (const r of data ?? []) {
      if (r.action === FEED_ACTION.LIKE) liked.push(r.target_txid)
      else if (r.action === FEED_ACTION.REPOST) reposted.push(r.target_txid)
    }
  }

  const followed = []
  const others = authorIds.filter((id) => id !== acct.accountId)
  if (others.length > 0) {
    const { data } = await supabase
      .from('feed_follows')
      .select('followee_account_id')
      .eq('follower_account_id', acct.accountId)
      .in('followee_account_id', others)
    for (const r of data ?? []) followed.push(r.followee_account_id)
  }

  // Which of the visible authors are in a block relationship with the viewer
  // (either direction) — the client drops their posts from the cached feed.
  const blockedSet = await blockedAccountIds(supabase, acct.accountId)
  const blocked = authorIds.filter((id) => blockedSet.has(id))

  return NextResponse.json({ liked, reposted, followed, blocked })
}
