export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/db'
import { getAuthedAccount } from '@/lib/authHelpers'
import { getFeedNotifications } from '@/lib/feedNotifications'
import { CONVERSATIONAL_TYPES } from '@/lib/notifFormat'
import { countMintAttention } from '@/lib/mintPaymentAlerts'

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
  // `filter=mentions` narrows to the respond-worthy types (the Mentions tab);
  // anything else returns the full mixed list (the All tab).
  const types =
    request.nextUrl.searchParams.get('filter') === 'mentions' ? CONVERSATIONAL_TYPES : null

  const supabase = adminDb()
  const { notifications, unreadCount, nextCursor } = await getFeedNotifications(
    supabase,
    acct.accountId,
    { before, types },
  )

  // Admin sessions also get two standing to-dos folded into the same bell
  // (distinct from read/unread notifications): the AI_SATOSHI review-queue
  // count, and mint money that needs a person (lib/mintPaymentAlerts). Both
  // fields are ABSENT for everyone else — their payload is unchanged.
  if (acct.isAdmin) {
    const [{ count }, mintAttention] = await Promise.all([
      supabase.from('agent_queue').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      countMintAttention(supabase),
    ])
    return NextResponse.json({
      notifications,
      unreadCount,
      nextCursor,
      agentPending: count ?? 0,
      mintAttention,
    })
  }

  return NextResponse.json({ notifications, unreadCount, nextCursor })
}
