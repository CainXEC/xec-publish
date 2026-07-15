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

const PING_MS = 25_000
const STORE_KEY = 'pow_tab_id'

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

    const ping = async () => {
      try {
        const res = await fetch('/api/presence', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
          cache: 'no-store',
          keepalive: true,
        })
        const data = await res.json()
        if (!stopped && typeof data?.count === 'number') {
          window.dispatchEvent(new CustomEvent('pow:presence', { detail: data.count }))
        }
      } catch {
        /* best-effort; the next beat covers it */
      }
    }

    void ping()
    const iv = setInterval(ping, PING_MS)
    const onVis = () => {
      if (document.visibilityState === 'visible') void ping()
    }
    document.addEventListener('visibilitychange', onVis)

    return () => {
      stopped = true
      clearInterval(iv)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  return null
}
