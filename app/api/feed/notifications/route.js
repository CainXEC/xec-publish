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

  return NextResponse.json({ notifications, unreadCount, nextCursor })
}
