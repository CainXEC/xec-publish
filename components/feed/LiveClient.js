'use client'
// =============================================================================
//  LiveClient.js — "Live on eCash" as a full-screen mobile route (/live).
//
//  Reuses the exact ActivityRail that renders as the desktop right column,
//  forced active (minWidth=0) so it fetches, subscribes to the LOKAD doorbell,
//  and renders full-width here. No reading pane on this standalone route, so
//  thread rows navigate to the thread page. Reached via the bottom bar's
//  "Live" tab.
// =============================================================================

import FeedTopbar from '@/components/feed/FeedTopbar'
import { FEED_CSS } from '@/components/feed/feedTheme'
import ActivityRail from '@/components/feed/ActivityRail'

export default function LiveClient({ signedIn = false, isAuthor = false }) {
  return (
    <div className="pow-feed">
      <style>{FEED_CSS}</style>
      <FeedTopbar signedIn={signedIn} isAuthor={isAuthor} />
      <main className="wrap" style={{ paddingTop: '18px' }}>
        <ActivityRail minWidth={0} />
      </main>
    </div>
  )
}
