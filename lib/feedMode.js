// =============================================================================
//  lib/feedMode.js — the ONE dial for how the "For You" feed is ordered.
//
//  While the feed is small we serve it as a pure reverse-chronological timeline
//  (newest first). That means THREE reorderings are switched off together, so
//  the order a reader sees is exactly created_at DESC and is identical on every
//  refresh:
//    - server engagement ranking      (rankFeedCandidates, lib/getFeed.js)
//    - server per-viewer follow nudge  (applyFollowNudge, lib/getFeed.js)
//    - client unseen-first reshuffle   (reorderBySeen, components/feed/FeedClient.js)
//
//  The client reshuffle is the subtle one: it floats posts you haven't scrolled
//  past yet to the top, using a per-browser "seen" map that changes as you read
//  — so with it on, the sort visibly changes every refresh. That's the opposite
//  of a stable chronological feed, so it's gated here too.
//
//  Flip to `true` to restore all three at once. This module has NO imports so it
//  is safe in both a server module and a client component.
// =============================================================================
export const RANK_FORYOU_FEED = false
