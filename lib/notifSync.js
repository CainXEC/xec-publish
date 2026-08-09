'use client'
// =============================================================================
//  notifSync.js — cross-tab "notifications were just read" signal.
//
//  Reading /notifications marks everything read SERVER-SIDE (see
//  app/notifications/page.js), but every OTHER open tab's header bell only
//  learns that on its own next ~60s poll — until then its badge sits stale.
//  Same fix the Pocket already uses for cross-tab sync (lib/pocket/storage.js):
//  a localStorage write fires the native `storage` event in every OTHER
//  same-origin tab (never the tab that wrote it), so no server push is needed.
// =============================================================================

const STORAGE_KEY = 'pow_notif_read_at'

/** Call once notifications have been marked read (NotificationsPageClient's
 *  mount, since that's exactly when app/notifications/page.js's server-side
 *  mark-read already ran). Broadcasts to every OTHER open tab. */
export function broadcastNotificationsRead() {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, String(Date.now()))
  } catch {
    /* storage full/disabled — the other tab's next poll still catches up */
  }
}

/** Subscribe to the signal from OTHER tabs. Returns an unsubscribe function. */
export function onNotificationsReadElsewhere(cb) {
  if (typeof window === 'undefined') return () => {}
  const handler = (e) => {
    if (e?.key === STORAGE_KEY) cb()
  }
  window.addEventListener('storage', handler)
  return () => window.removeEventListener('storage', handler)
}
