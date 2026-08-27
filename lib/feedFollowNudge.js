// =============================================================================
//  lib/feedFollowNudge.js
//  The per-viewer "follow nudge" for the For You feed — a small, PURE reorder
//  layered on top of the shared, engagement-ranked window (getCachedForYouPage).
//
//  The shared ranking is viewer-neutral and cached; this personalizes it without
//  touching that cache: posts by authors the viewer follows rise a few slots,
//  so the feed feels a bit more "mine" while the engagement order still leads.
//  Applied per page, so every "load more" window is nudged too — but only WITHIN
//  that window (it never pulls a post across page boundaries, which would need
//  global per-viewer ranking and break the shared cache + time cursor).
// =============================================================================

// How many slots a followed author's post rises within its page — a bounded
// head start, NOT a "followed first" filter. Tunable; keep it well under a page.
export const FOLLOW_NUDGE_SLOTS = 5

/**
 * Stable, bounded reorder: lift posts whose author is in `followed` up by
 * FOLLOW_NUDGE_SLOTS. Keyed on rank POSITION (score isn't exposed here), with the
 * original index as an explicit tiebreak so equal keys keep their engagement
 * order — a followed post never leapfrogs another followed post that ranked above
 * it, and non-followed posts keep their relative order.
 *
 * @param {object[]} posts  engagement-ranked window (index 0 = highest)
 * @param {Set<string>} followed  author account-ids the viewer follows
 * @returns {object[]} a new array; `posts` is returned as-is when nothing applies
 */
export function applyFollowNudge(posts, followed) {
  if (!Array.isArray(posts) || !followed || followed.size === 0) return posts
  return posts
    .map((p, i) => ({
      p,
      i,
      key: i - (followed.has(p.author_account_id) ? FOLLOW_NUDGE_SLOTS : 0),
    }))
    .sort((a, b) => a.key - b.key || a.i - b.i)
    .map((x) => x.p)
}
