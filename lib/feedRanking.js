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
//  The ranker is engagement-weighted: it starts from recency but lets a post
//  that's drawing conversation (replies/quotes/reposts/likes) float up a few
//  slots, so an active thread resurfaces above brand-new-but-quiet posts. It
//  only ever reorders WITHIN the fetched window (a permutation), which is what
//  keeps the time-based keyset cursor valid — resurfacing is therefore local to
//  each page, not a global bump of stale posts to the very top.
// =============================================================================

// How much a post can climb on engagement, expressed as an equivalent "age
// bonus" in hours: an infinitely-hot post scores as if it were BOOST_MAX_HOURS
// newer than it is. Kept modest so ranking stays recognizably chronological.
const BOOST_MAX_HOURS = 12

// Per-reaction weights feeding the engagement tally. Conversation (replies,
// quotes) is valued above passive signals (reposts, likes) because resurfacing
// is meant to spotlight active discussion.
const WEIGHTS = { reply: 3, quote: 3, repost: 2, like: 1 }

function toCount(v) {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * A post's display score, higher = shown earlier. Recency is the spine (negative
 * age in hours); engagement adds a saturating bonus so a lively post rises but
 * can never outrank something dramatically newer. Deterministic — no randomness —
 * so the same window always ranks the same way.
 */
function scorePost(post, nowMs) {
  const created = new Date(post?.created_at ?? 0).getTime()
  const ageHours = Number.isFinite(created) ? Math.max(0, (nowMs - created) / 3.6e6) : 0

  const weighted =
    toCount(post?.reply_count) * WEIGHTS.reply +
    toCount(post?.quote_count) * WEIGHTS.quote +
    toCount(post?.repost_count) * WEIGHTS.repost +
    toCount(post?.like_count) * WEIGHTS.like

  // log1p saturates: the first few reactions matter most, then diminishing
  // returns, so a viral post can't run away with the whole page. Normalized so
  // the bonus asymptotically approaches BOOST_MAX_HOURS.
  const boost = BOOST_MAX_HOURS * (Math.log1p(weighted) / (Math.log1p(weighted) + 4))

  return boost - ageHours
}

/**
 * Order a fetched window of candidate posts for display.
 *
 * @param {object[]} posts  Candidate rows, already newest-first from the DB.
 * @returns {object[]} The posts in display order. A permutation of the input —
 *   never adds or drops rows, so the caller's keyset cursor (derived from the raw
 *   time order, before ranking) stays valid.
 */
export function rankFeedCandidates(posts) {
  const list = posts ?? []
  if (list.length < 2) return list

  const nowMs = Date.now()
  // Sort a COPY (never mutate the caller's array). Score desc; ties fall back to
  // created_at desc so ordering stays stable and newest-first among equals.
  return [...list].sort((a, b) => {
    const diff = scorePost(b, nowMs) - scorePost(a, nowMs)
    if (diff !== 0) return diff
    return new Date(b?.created_at ?? 0).getTime() - new Date(a?.created_at ?? 0).getTime()
  })
}
