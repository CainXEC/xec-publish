'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'

// The agent runs on a schedule measured in hours, so a lazy poll keeps the
// badge honest without adding another 60s heartbeat next to the bell's.
const POLL_MS = 5 * 60_000

/**
 * Topbar chip for the AI_SATOSHI review queue — the admin's way INTO
 * /admin/agent (there's no other nav entry, so it shows even at count 0).
 * Self-fetching like PocketChip: renders null until /api/admin/agent/
 * pending-count confirms the session is an admin, so every other visitor's
 * topbar is untouched. A 404 (non-admin) stops the polling for good — one
 * cheap request per page load, then silence.
 */
export default function AdminQueueChip({ signedIn = false }) {
  const [count, setCount] = useState(null) // null = not admin / not loaded yet
  const deniedRef = useRef(false)

  useEffect(() => {
    if (!signedIn) return undefined
    let dead = false
    const load = async () => {
      if (deniedRef.current) return
      try {
        const res = await fetch('/api/admin/agent/pending-count', { cache: 'no-store' })
        if (res.status === 404) {
          deniedRef.current = true
          return
        }
        if (!res.ok) return
        const data = await res.json()
        if (!dead) setCount(Number(data.count) || 0)
      } catch {
        /* best-effort; the chip just won't update this cycle */
      }
    }
    load()
    const id = setInterval(load, POLL_MS)
    // Approve/veto on /admin/agent fires this so the count updates instantly.
    window.addEventListener('agent-queue-changed', load)
    return () => {
      dead = true
      clearInterval(id)
      window.removeEventListener('agent-queue-changed', load)
    }
  }, [signedIn])

  if (count == null) return null

  return (
    <Link
      href="/admin/agent"
      className="agentbtn"
      aria-label={`Agent queue — ${count} pending draft${count === 1 ? '' : 's'}`}
      title="Agent queue"
    >
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <rect x="5" y="9" width="14" height="10" rx="2" />
        <path d="M12 5.5V9" />
        <circle cx="12" cy="4.25" r="1.25" />
        <path d="M9.5 13.25v1.5M14.5 13.25v1.5" />
      </svg>
      {count > 0 ? <span className="notifbadge">{count > 99 ? '99+' : count}</span> : null}
    </Link>
  )
}
