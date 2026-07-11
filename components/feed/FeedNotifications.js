'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import BellIcon from '@/components/BellIcon'

function timeAgo(iso) {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function truncateAddress(addr) {
  const t = String(addr ?? '').trim()
  if (t.length <= 16) return t
  return `${t.slice(0, 10)}…${t.slice(-4)}`
}

// "@handle" shows as-is; a raw address is truncated for the byline.
function actorLabel(identity) {
  const id = typeof identity === 'string' ? identity.trim() : ''
  return id.startsWith('@') ? id : truncateAddress(id)
}

const VERB = {
  reply: 'replied to your post',
  quote: 'quoted your post',
  like: 'liked your post',
  repost: 'reposted your post',
  follow: 'followed you',
}

// An offer names the handle it courts (decorated server-side onto the row).
function notifText(n) {
  if (n.type === 'offer') {
    return n.handle ? `made an offer on @${n.handle}` : 'made an offer on your handle'
  }
  return VERB[n.type] ?? 'interacted with your post'
}

// Reply/quote/like/repost open the target post's thread; a follow opens the
// follower's profile (identifier resolves a handle or a bare address); an
// offer opens the gallery on that handle's card, where the amounts live.
function targetHref(n) {
  if (n.type === 'follow') {
    const id = String(n.actor_identity ?? '').replace(/^@/, '').trim()
    return id ? `/@${encodeURIComponent(id)}` : '#'
  }
  if (n.type === 'offer') {
    return n.handle
      ? `/marketplace?view=all&q=${encodeURIComponent(n.handle)}`
      : '/marketplace?view=all'
  }
  return n.post_txid ? `/feed/${n.post_txid}` : '#'
}

const POLL_MS = 60_000

/**
 * The header bell: unread-count badge + a dropdown of the signed-in account's
 * recent feed notifications (replies, quotes, likes, reposts, follows). Polls
 * the count on an interval; opening the dropdown marks everything read. Renders
 * nothing for a signed-out viewer.
 */
export default function FeedNotifications({ signedIn = false }) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [unread, setUnread] = useState(0)
  const rootRef = useRef(null)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/feed/notifications', { cache: 'no-store' })
      if (!res.ok) return
      const data = await res.json()
      setItems(Array.isArray(data.notifications) ? data.notifications : [])
      setUnread(Number(data.unreadCount) || 0)
    } catch {
      /* best-effort; the bell just won't update this cycle */
    }
  }, [])

  // Initial load + polling while signed in.
  useEffect(() => {
    if (!signedIn) return
    void refresh()
    const id = setInterval(() => void refresh(), POLL_MS)
    return () => clearInterval(id)
  }, [signedIn, refresh])

  // Close on outside click.
  useEffect(() => {
    if (!open) return
    const onDocClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  const toggleOpen = useCallback(() => {
    setOpen((wasOpen) => {
      const next = !wasOpen
      if (next) {
        void refresh() // freshen the list as it opens
        if (unread > 0) {
          setUnread(0) // optimistic — clear the badge immediately
          fetch('/api/feed/notifications/mark-read', { method: 'POST' }).catch(() => {})
        }
      }
      return next
    })
  }, [refresh, unread])

  if (!signedIn) return null

  return (
    <span className="notifbell" ref={rootRef}>
      <button
        type="button"
        className="notifbtn"
        onClick={toggleOpen}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : 'Notifications'}
      >
        <BellIcon />
        {unread > 0 ? (
          <span className="notifbadge">{unread > 9 ? '9+' : unread}</span>
        ) : null}
      </button>
      {open ? (
        <div className="notifpop" role="menu">
          <div className="notifpop-head">Notifications</div>
          {items.length === 0 ? (
            <p className="notifempty">Nothing yet.</p>
          ) : (
            <ul className="notiflist">
              {items.map((n) => {
                const href = targetHref(n)
                return (
                  <li key={n.id}>
                    <Link
                      href={href}
                      className={`notifitem${n.read ? '' : ' unread'}`}
                      onClick={() => setOpen(false)}
                    >
                      <span className="notifmsg">
                        <strong>{actorLabel(n.actor_identity)}</strong>{' '}
                        {notifText(n)}
                      </span>
                      <span className="notiftime">{timeAgo(n.created_at)}</span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      ) : null}
    </span>
  )
}
