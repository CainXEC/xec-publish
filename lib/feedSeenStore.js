// =============================================================================
//  feedSeenStore.js — a per-browser record of which For You posts you've already
//  SEEN (scrolled into view), so a returning visitor's feed floats unseen content
//  to the top instead of showing the same ranked leader every time.
//
//  Purely client-side (localStorage): "seen" is inherently per-viewer, and the
//  ranked feed itself is a shared, viewer-neutral cache — so this layers on top,
//  like the like/repost viewer-state overlay. Never sent to the server.
// =============================================================================

const KEY = 'pow_feed_seen'
// Cap the map so it can't grow without bound; when over, the oldest-seen entries
// are dropped (they're the least useful to remember).
const MAX = 600

function load() {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(KEY)
    const m = raw ? JSON.parse(raw) : {}
    return m && typeof m === 'object' ? m : {}
  } catch {
    return {}
  }
}

function save(map) {
  if (typeof window === 'undefined') return
  try {
    let entries = Object.entries(map)
    if (entries.length > MAX) {
      // Keep the most-recently-seen MAX entries.
      entries = entries.sort((a, b) => b[1] - a[1]).slice(0, MAX)
    }
    window.localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(entries)))
  } catch {
    /* quota / disabled storage — seen tracking is best-effort */
  }
}

/** The seen map: { txid: lastSeenMs }. Snapshot; callers don't mutate it. */
export function getSeenMap() {
  return load()
}

/** Record that `txid` was seen now (updates its timestamp). Debounced writes are
 *  the caller's job; this batches nothing, so mark sparingly (on first view). */
export function markSeen(txid) {
  if (typeof window === 'undefined' || !txid) return
  const map = load()
  map[txid] = Date.now()
  save(map)
}

/**
 * Reorder a ranked page so UNSEEN posts lead (keeping their ranked order), then
 * already-seen posts below — oldest-seen first, so even when everything's been
 * seen the top still rotates on each return. `seen` is a snapshot taken ONCE (so
 * the list doesn't reshuffle under the reader as they scroll and mark new posts).
 * Non-real rows (mint digests, which have no txid) keep their place among unseen.
 */
export function reorderBySeen(posts, seen) {
  const list = Array.isArray(posts) ? posts : []
  const unseen = []
  const seenRows = []
  for (const p of list) {
    const t = p?.txid
    if (t && seen[t]) seenRows.push(p)
    else unseen.push(p)
  }
  seenRows.sort((a, b) => (seen[a.txid] ?? 0) - (seen[b.txid] ?? 0)) // oldest-seen first
  return [...unseen, ...seenRows]
}
