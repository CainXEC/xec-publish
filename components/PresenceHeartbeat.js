'use client'
// =============================================================================
//  PresenceHeartbeat.js — the "who's here" beacon, mounted once site-wide.
//
//  Every open tab pings /api/presence on a ~25s heartbeat with a stable
//  per-tab id, and re-pings whenever the tab is refocused so a returning
//  reader is counted promptly. It renders NOTHING and never blocks: the first
//  ping fires after paint, and each request is fire-and-forget. The count that
//  comes back is broadcast on a `pow:presence` window event so any listener
//  (the desktop activity rail) can show it — this tab's own heartbeat doubles
//  as the rail's data source, so the rail needs no request of its own.
//
//  Runs everywhere (mobile included) so the count reflects the whole site,
//  even though only the desktop rail displays it.
// =============================================================================

import { useEffect } from 'react'

const PING_MS = 90_000
// Ask the server for the live count this rarely; the frequent beats in between
// just refresh presence (a single cheap Redis command). Reading the count is the
// expensive part, so we do it sparingly to stay under the Redis request cap.
// Tuned for the free Upstash tier (500k requests/month) as the permanent plan:
// at ~90s beats + a 5-min count refresh, one always-open tab costs ~55k/month,
// so the cap comfortably absorbs the handful of concurrent readers this site has.
const COUNT_EVERY_MS = 300_000
const STORE_KEY = 'pow_tab_id'
const PRESENCE_EVENT = 'pow:presence'
// A freshly-mounted listener (the activity rail after an in-app navigation)
// fires this to ask for the current number instead of waiting for the next beat.
const PRESENCE_REQUEST = 'pow:presence-request'

// Broadcast a count AND remember it on `window`, so a listener that mounts
// between beats can read the last-known value synchronously (see ActivityRail).
function publishCount(n) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return
  try {
    window.__powPresenceCount = n
  } catch {
    /* non-fatal */
  }
  window.dispatchEvent(new CustomEvent(PRESENCE_EVENT, { detail: n }))
}

// One id per browser tab. sessionStorage is per-tab, so two tabs = two ids =
// two counted sessions (the ordinary meaning of "online now").
function tabId() {
  try {
    let id = sessionStorage.getItem(STORE_KEY)
    if (!id) {
      const raw =
        (typeof crypto !== 'undefined' && crypto.randomUUID?.()) ||
        `${Date.now()}-${Math.random().toString(36).slice(2)}`
      id = raw.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64)
      sessionStorage.setItem(STORE_KEY, id)
    }
    return id
  } catch {
    return null
  }
}

export default function PresenceHeartbeat() {
  useEffect(() => {
    const id = tabId()
    if (!id) return
    let stopped = false
    let lastPingAt = 0
    let lastCountAt = 0

    // `wantCount` asks the server to compute + return the live count. We only
    // want it on the first beat and then ~every COUNT_EVERY_MS; the beats in
    // between are cheap presence refreshes and keep the last number on screen.
    const ping = async (wantCount = false) => {
      lastPingAt = Date.now()
      const includeCount = wantCount || lastCountAt === 0 || lastPingAt - lastCountAt >= COUNT_EVERY_MS
      if (includeCount) lastCountAt = lastPingAt
      try {
        const res = await fetch('/api/presence', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, count: includeCount }),
          cache: 'no-store',
          keepalive: true,
        })
        const data = await res.json()
        // A refresh-only beat returns no count; keep whatever we last showed.
        if (!stopped && typeof data?.count === 'number') publishCount(data.count)
      } catch {
        /* best-effort; the next beat covers it */
      }
    }

    void ping(true)
    const iv = setInterval(() => void ping(), PING_MS)
    // A returning reader should be counted (and see a fresh number) promptly.
    const onVis = () => {
      if (document.visibilityState !== 'visible') return
      // Rapid focus toggling (alt-tabbing between windows) shouldn't fire a
      // POST per switch — the beat and onRequest already cover the gap.
      if (Date.now() - lastPingAt < 30_000) return
      void ping(true)
    }
    document.addEventListener('visibilitychange', onVis)

    // Answer a rail that just mounted: re-broadcast the cached count at once so
    // it paints instantly, then refresh from the server — unless we just pinged
    // (dedupes the double-mount on hard load and rapid in-app nav bursts).
    const onRequest = () => {
      if (typeof window.__powPresenceCount === 'number') {
        window.dispatchEvent(
          new CustomEvent(PRESENCE_EVENT, { detail: window.__powPresenceCount }),
        )
      }
      // No cached number yet (a fresh load with the rail already on screen) →
      // fetch one now; otherwise let the normal cadence handle the refresh.
      if (typeof window.__powPresenceCount !== 'number' && Date.now() - lastPingAt > 5_000) {
        void ping(true)
      }
    }
    window.addEventListener(PRESENCE_REQUEST, onRequest)

    return () => {
      stopped = true
      clearInterval(iv)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener(PRESENCE_REQUEST, onRequest)
    }
  }, [])

  return null
}
