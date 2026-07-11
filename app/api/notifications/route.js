export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getAuthedAccount } from '@/lib/authHelpers'

// The author's unread notifications, newest first, with keyset pagination for
// the dashboard bell's "Load more" — mirrors /api/feed/notifications so a big
// overnight batch isn't capped at the first 20. Unread-only (the dashboard is an
// inbox: "Mark all read" clears it); `before` (an ISO timestamp) pages back
// through older unread ones from the oldest already shown.
const PAGE = 20
const COLS =
  'id, message, post_id, comment_id, read, created_at, posts(slug, title, legacy)'

export async function GET(request) {
  const acct = await getAuthedAccount()
  if (!acct?.authorId) {
    return NextResponse.json({ notifications: [], unreadCount: 0, nextCursor: null })
  }

  const admin = createSupabaseAdminClient()
  if (!admin) {
    return NextResponse.json({ notifications: [], unreadCount: 0, nextCursor: null })
  }

  const before = request.nextUrl.searchParams.get('before') || null

  let listQuery = admin
    .from('notifications')
    .select(COLS)
    .eq('author_id', acct.authorId)
    .eq('read', false)
    .order('created_at', { ascending: false })
    .limit(PAGE)
  if (before) listQuery = listQuery.lt('created_at', before)

  const [{ data, error }, countRes] = await Promise.all([
    listQuery,
    // The unread total drives the badge — a first-page concern; skip it when
    // paging older notifications.
    before
      ? Promise.resolve({ count: null })
      : admin
          .from('notifications')
          .select('id', { count: 'exact', head: true })
          .eq('author_id', acct.authorId)
          .eq('read', false),
  ])

  if (error) {
    return NextResponse.json({ notifications: [], unreadCount: 0, nextCursor: null })
  }

  const rows = data ?? []
  const nextCursor = rows.length === PAGE ? rows[rows.length - 1].created_at : null
  return NextResponse.json({ notifications: rows, unreadCount: countRes.count ?? 0, nextCursor })
}
