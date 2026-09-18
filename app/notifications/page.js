import { redirect } from 'next/navigation'
import { after } from 'next/server'
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
  // Don't block the render on the read-marking WRITE — the render already
  // captured the pre-mark state above (so it still highlights what was unread).
  // Flush the page first, then mark read via after(); the tap feels instant
  // instead of waiting on a write before anything appears.
  if (unreadCount > 0) {
    after(() => markFeedNotificationsRead(supabase, acct.accountId))
  }

  return (
    <div className="pow-feed">
      <style>{FEED_CSS}</style>
      <FeedTopbar signedIn isAuthor={Boolean(acct.authorId)} />
      <main className="wrap notif-page">
        <NotificationsPageClient
          initialItems={notifications}
          initialCursor={nextCursor}
          agentPending={agentPending}
        />
      </main>
    </div>
  )
}
