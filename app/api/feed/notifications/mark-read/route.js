export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { getAuthedAccount } from '@/lib/authHelpers'
import { markFeedNotificationsRead } from '@/lib/feedNotifications'

/**
 * Mark every unread feed notification for the signed-in account as read. Called
 * when the header bell dropdown is opened.
 */
export async function POST() {
  const acct = await getAuthedAccount()
  if (!acct) {
    return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 })
  }

  const supabase = createServerSupabase()
  await markFeedNotificationsRead(supabase, acct.accountId)

  return NextResponse.json({ ok: true })
}
