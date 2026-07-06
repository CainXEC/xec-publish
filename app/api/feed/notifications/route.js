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
export async function GET() {
  const acct = await getAuthedAccount()
  if (!acct) {
    return NextResponse.json({ notifications: [], unreadCount: 0 })
  }

  const supabase = createServerSupabase()
  const { notifications, unreadCount } = await getFeedNotifications(supabase, acct.accountId)

  return NextResponse.json({ notifications, unreadCount })
}
