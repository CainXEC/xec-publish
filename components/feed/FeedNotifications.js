'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import BellIcon from '@/components/BellIcon'

const POLL_MS = 60_000

/**
 * The header bell: unread-count badge, linking to the full /notifications page
 * (X-style — replies/comments show their full text there, likes/reposts/follows
 * group). Polls the count on an interval. Renders nothing for a signed-out
 * viewer. Mark-as-read happens on the notifications page itself, not here.
 *
 */
export default function FeedNotifications({ signedIn = false }) {
  const [unread, setUnread] = useState(0)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/feed/notifications', { cache: 'no-store' })
      if (!res.ok) return
      const data = await res.json()
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
      onClick={() => setUnread(0)}
    >
      <BellIcon />
      {badgeCount > 0 ? (
        <span className="notifbadge">{badgeCount > 99 ? '99+' : badgeCount}</span>
      ) : null}
    </Link>
  )
}
