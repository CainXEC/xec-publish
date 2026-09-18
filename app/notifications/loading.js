import { FEED_CSS } from '@/components/feed/feedTheme'
import FeedTopbar from '@/components/feed/FeedTopbar'

// Shown the INSTANT you tap the bell, while the force-dynamic page does its
// per-viewer DB work (fetch + mark-read). Without it the previous page stayed on
// screen through that gap, so the tap read as dead and you'd tap the bell again.
// The pow-feed shell + topbar match the real page so only the list fills in.
export default function NotificationsLoading() {
  return (
    <div className="pow-feed">
      <style>{FEED_CSS}</style>
      <FeedTopbar signedIn isAuthor={false} />
      <main className="wrap notif-page">
        {/* Static tab placeholders so the skeleton's layout matches the real page
            (same spacing) and only the rows fill in. */}
        <div className="tabs" aria-hidden="true">
          <span className="tab on">All notifications</span>
          <span className="tab">Mentions</span>
        </div>
        <ul className="notifpage-list" aria-hidden="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <li key={i}>
              <div className="notifpage-row">
                <span className="notif-sk notif-sk-glyph" />
                <div className="notifpage-main">
                  <span className="notif-sk notif-sk-line" style={{ width: '68%' }} />
                  <span className="notif-sk notif-sk-line" style={{ width: '42%' }} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      </main>
    </div>
  )
}
