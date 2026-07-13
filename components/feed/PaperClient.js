'use client'
// =============================================================================
//  PaperClient.js — the "Front Page" as a full-screen mobile route (/paper).
//
//  Reuses the exact ArticleRail that renders as the desktop left column, forced
//  active (minWidth=0) so it fetches and renders full-width here. No reading
//  pane on this standalone route, so headlines navigate to the article page —
//  the right behaviour on mobile. Reached via the bottom bar's "Paper" tab.
// =============================================================================

import FeedTopbar from '@/components/feed/FeedTopbar'
import { FEED_CSS } from '@/components/feed/feedTheme'
import ArticleRail from '@/components/feed/ArticleRail'

export default function PaperClient({ signedIn = false, isAuthor = false }) {
  return (
    <div className="pow-feed">
      <style>{FEED_CSS}</style>
      <FeedTopbar signedIn={signedIn} isAuthor={isAuthor} />
      <main className="wrap" style={{ paddingTop: '18px' }}>
        <ArticleRail minWidth={0} />
      </main>
    </div>
  )
}
