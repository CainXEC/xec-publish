import { redirect } from 'next/navigation'
import { adminDb } from '@/lib/db'
import { getAuthedAccount } from '@/lib/authHelpers'
import { getFeedNotifications, markFeedNotificationsRead } from '@/lib/feedNotifications'
import { FEED_CSS } from '@/components/feed/feedTheme'
import FeedTopbar from '@/components/feed/FeedTopbar'
import NotificationsPageClient from '@/components/feed/NotificationsPageClient'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Notifications — proofofwriting',
}

const PAGE_SIZE = 30

export default async function NotificationsPage() {
  const acct = await getAuthedAccount()
  if (!acct) redirect('/login')

  const supabase = adminDb()

  // Capture the current read state BEFORE marking read, so this render can
  // still highlight what was unread a moment ago (mirrors the old bell
  // dropdown's ordering) — then mark everything read for next time.
  const [{ notifications, unreadCount, nextCursor }, agentPending] = await Promise.all([
    getFeedNotifications(supabase, acct.accountId, { limit: PAGE_SIZE }),
    acct.isAdmin
      ? supabase
          .from('agent_queue')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'pending')
          .then((r) => r.count ?? 0)
      : Promise.resolve(null),
  ])
  if (unreadCount > 0) await markFeedNotificationsRead(supabase, acct.accountId)

  return (
    <div className="pow-feed">
      <style>{FEED_CSS}</style>
      <FeedTopbar signedIn isAuthor={Boolean(acct.authorId)} />
      <main className="wrap wrap-full" style={{ paddingTop: '28px' }}>
        <h1 className="dashwelcome">Notifications</h1>
        <NotificationsPageClient
          initialItems={notifications}
          initialCursor={nextCursor}
          agentPending={agentPending}
        />
      </main>
    </div>
  )
}
