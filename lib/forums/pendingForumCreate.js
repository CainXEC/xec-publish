// Per-browser record of an IN-FLIGHT forum creation, so a paid-but-not-confirmed
// forum can be finished later. The confirm that actually creates the forum runs
// only in the CreateForum poll — which dies if the component unmounts, the user
// navigates away, or (on mobile) the page reloads after the Cashtab round-trip.
// When that happens the payment is on-chain but no forum exists. We stash the
// creation payload here at pay time and replay it the next time the user is in
// the Forums area (see ForumDirectory), where the idempotent confirm creates it.
//
// One slot — a new create replaces the old. Values live at most a day.

const KEY = 'pow_pending_forum_v1'
const TTL_MS = 24 * 60 * 60 * 1000

export function savePendingForum(entry) {
  if (typeof window === 'undefined' || !entry?.slug) return
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...entry, savedAt: Date.now() }))
  } catch {
    /* storage full/disabled — recovery is best-effort */
  }
}

export function loadPendingForum() {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return null
    const e = JSON.parse(raw)
    if (!e?.slug || Date.now() - (e.savedAt || 0) > TTL_MS) {
      window.localStorage.removeItem(KEY)
      return null
    }
    return e
  } catch {
    return null
  }
}

export function clearPendingForum(slug = null) {
  if (typeof window === 'undefined') return
  try {
    // Don't clobber a NEWER pending create than the one being cleared.
    if (slug) {
      const e = loadPendingForum()
      if (e && e.slug !== slug) return
    }
    window.localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
