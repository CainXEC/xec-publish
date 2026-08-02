// =============================================================================
//  pinnedStore — the viewer's ONE pinned feed-post txid, shared across every
//  pin button (feed rows, profile, thread, dashboard).
//
//  WHY: `post.isPinned` is only marked on the profile's pinned row, so the same
//  post shown in the feed / a thread came back unpinned and its button read
//  "Pin" even when it was pinned — and an optimistic flip reverted on refresh.
//  This store holds the viewer's single pinned txid (accounts.pinned_post_txid),
//  hydrated once from /api/me, so `pinned = isOwn && txid === myPinned` is
//  correct everywhere, survives reload, and enforces "one pin" (pinning a new
//  post instantly un-highlights the old one — every subscriber re-renders).
// =============================================================================

let pinnedTxid = null
let hydrated = false
let hydrating = null
const subs = new Set()

function emit() {
  for (const fn of subs) {
    try {
      fn(pinnedTxid)
    } catch {
      /* a bad subscriber shouldn't break the rest */
    }
  }
}

/** The viewer's pinned txid (or null). */
export function getMyPinnedTxid() {
  return pinnedTxid
}

/** Set it (optimistic pin/unpin, or from a server truth). Notifies subscribers. */
export function setMyPinnedTxid(txid) {
  const next = txid || null
  if (next === pinnedTxid) return
  pinnedTxid = next
  emit()
}

/** Subscribe to changes; returns an unsubscribe fn. */
export function subscribePinned(fn) {
  subs.add(fn)
  return () => subs.delete(fn)
}

/**
 * Seed the store from a server-provided isPinned (e.g. the profile's pinned row)
 * before /api/me hydrates, so that surface shows the right state with no flash.
 * Never clears — only /api/me (below) or an explicit toggle sets null.
 */
export function seedMyPinnedTxid(txid) {
  if (txid && !hydrated && pinnedTxid !== txid) setMyPinnedTxid(txid)
}

/** Fetch the viewer's pinned txid from /api/me exactly once (deduped). */
export async function hydratePinned() {
  if (hydrated || typeof window === 'undefined') return
  if (hydrating) return hydrating
  hydrating = (async () => {
    try {
      const res = await fetch('/api/me', { cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      pinnedTxid = data?.authenticated ? data.pinnedPostTxid || null : null
      hydrated = true
      emit()
    } catch {
      /* leave unhydrated; a later mount retries */
    } finally {
      hydrating = null
    }
  })()
  return hydrating
}
