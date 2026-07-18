export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { getAuthedAccount } from '@/lib/authHelpers'
import { getFeedNotifications } from '@/lib/feedNotifications'

/**
 * The signed-in account's recent feed notifications + unread count, for the
 * header bell. Account-keyed (not author-keyed), so reader-only accounts get
 * their replies/likes/reposts/quotes/follows too. Empty for a signed-out viewer.
 */
export async function GET(request) {
  const acct = await getAuthedAccount()
  if (!acct) {
    return NextResponse.json({ notifications: [], unreadCount: 0, nextCursor: null })
  }

  // `before` (ISO timestamp) drives "Load more": page back through older
  // notifications from the oldest one already shown.
  const before = request.nextUrl.searchParams.get('before') || null

  const supabase = createServerSupabase()
  const { notifications, unreadCount, nextCursor } = await getFeedNotifications(
    supabase,
    acct.accountId,
    { before },
  )

  // Admin sessions also get the AI_SATOSHI review-queue count, folded into the
  // same bell (a standing to-do, distinct from read/unread notifications).
  // The field is ABSENT for everyone else — their payload is unchanged.
  let agentPending
  if (acct.isAdmin) {
    const { count } = await supabase
      .from('agent_queue')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
    agentPending = count ?? 0
  }

  return NextResponse.json(
    agentPending === undefined
      ? { notifications, unreadCount, nextCursor }
      : { notifications, unreadCount, nextCursor, agentPending },
  )
}
