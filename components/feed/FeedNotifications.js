'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import BellIcon from '@/components/BellIcon'

const POLL_MS = 60_000

/**
 * The header bell: unread-count badge, linking to the full /notifications page
 * (X-style — replies/comments show their full text there, likes/reposts/follows
 * group). Polls the count on an interval. Renders nothing for a signed-out
 * viewer. Mark-as-read happens on the notifications page itself, not here.
 *
 * Admin sessions additionally fold in the AI_SATOSHI review-queue count: the API
 * returns `agentPending` (absent for everyone else), which adds to the badge.
 * `onAgentPending` reports it up to FeedTopbar, which reveals the admin "agent"
 * hamburger item.
 */
export default function FeedNotifications({ signedIn = false, onAgentPending }) {
  const [unread, setUnread] = useState(0)
  const [agentPending, setAgentPending] = useState(null) // null = not an admin session

  const onAgentPendingRef = useRef(onAgentPending)
  useEffect(() => {
    onAgentPendingRef.current = onAgentPending
  }, [onAgentPending])

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/feed/notifications', { cache: 'no-store' })
      if (!res.ok) return
      const data = await res.json()
      const pending = typeof data.agentPending === 'number' ? data.agentPending : null
      setAgentPending(pending)
      onAgentPendingRef.current?.(pending)
      setUnread(Number(data.unreadCount) || 0)
    } catch {
      /* best-effort; the badge just won't update this cycle */
    }
  }, [])

  useEffect(() => {
    if (!signedIn) return
    const tick = () => void refresh()
    tick()
    const id = setInterval(tick, POLL_MS)
    return () => clearInterval(id)
  }, [signedIn, refresh])

  // Approve/veto on /admin/agent fires this so the queue count updates
  // instantly instead of waiting for the next poll.
  useEffect(() => {
    if (!signedIn) return
    const onQueueChange = () => void refresh()
    window.addEventListener('agent-queue-changed', onQueueChange)
    return () => window.removeEventListener('agent-queue-changed', onQueueChange)
  }, [signedIn, refresh])

  if (!signedIn) return null

  // The badge is unread notifications + pending agent drafts (admin only) —
  // the queue part survives mark-read; only judging the drafts clears it.
  const badgeCount = unread + (agentPending ?? 0)

  return (
    <Link
      href="/notifications"
      className="notifbtn"
      aria-label={badgeCount > 0 ? `Notifications (${badgeCount})` : 'Notifications'}
      // The target page is force-dynamic (it mark-reads on load); the default
      // prefetch still warms its loading.js shell for an instant skeleton.
      // When you're ALREADY on /notifications, this Link is a no-op navigation —
      // the page won't re-render server-side, so it never sees notifications that
      // arrived since it loaded. Fire an event so the page pulls the new ones in;
      // harmless anywhere else (no listener mounted).
      onClick={() => {
        setUnread(0)
        window.dispatchEvent(new CustomEvent('notifications:refresh'))
      }}
    >
      <BellIcon />
      {badgeCount > 0 ? (
        <span className="notifbadge">{badgeCount > 99 ? '99+' : badgeCount}</span>
      ) : null}
    </Link>
  )
}
