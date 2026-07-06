// =============================================================================
//  lib/feedRanking.js  —  the thin ranking seam (candidate → rank → serve)
//
//  The feed is fetched in two stages so ranking can grow without touching
//  pagination:
//    1. CANDIDATES — getFeed.js keyset-paginates a time-ordered window of posts
//       (stable cursor on created_at, id). This is the "what could we show" set.
//    2. RANK       — rankFeedCandidates reorders that window before it's served.
//
//  Keeping the cursor time-based (not score-based) is deliberate: paging stays
//  correct and duplicate-free even as the ranker reorders WITHIN each window,
//  because the boundary between windows is always a timestamp, never a score.
//
//  Today the ranker is intentionally near-chronological — it returns the
//  candidates newest-first, unchanged. It exists now as the single, obvious
//  place to introduce scoring later (recency decay, engagement, follow-graph
//  affinity, repost dedup/attribution) without reworking the fetch or the client.
// =============================================================================

/**
 * Order a fetched window of candidate posts for display.
 *
 * @param {object[]} posts  Candidate rows, already newest-first from the DB.
 * @returns {object[]} The posts in display order. Must be a permutation of the
 *   input — never adds or drops rows, so the caller's keyset cursor (derived from
 *   the raw time order, before ranking) stays valid. When scoring lands, add the
 *   signals it needs (viewer, engagement, …) as parameters here.
 */
export function rankFeedCandidates(posts) {
  // Chronological pass-through for now. When scoring lands, sort a COPY here and
  // return it; do not mutate the input array.
  return posts ?? []
}
