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
  unlock: 'unlocked your article',
  comment: 'commented on your article',
  comment_like: 'liked your comment',
}

// An offer names the handle it courts and, when the bidder named a price,
// the amount (both decorated server-side onto the row). The bell is only
// ever the HOLDER's view, so the amount is theirs to see.
function notifText(n) {
  if (n.type === 'offer') {
    const name = n.handle ? `@${n.handle}` : 'your handle'
    return n.offerAmountXec != null
      ? `offered ${Number(n.offerAmountXec).toLocaleString()} XEC for ${name}`
      : `made an offer on ${name}`
  }
  // Like/reply/repost all PAY the post's author (a like is a tip; a reply/repost
  // pays 94% to them), so when we recorded what was paid, append the amount (in
  // XEC; amount_sats is sats, 1 XEC = 100 sats). Older rows with no stored amount
  // fall back to the plain verb. (A quote doesn't pay the quoted author, so it's
  // deliberately left out.)
  if (n.type === 'like' || n.type === 'reply' || n.type === 'repost') {
    const xec = n.amount_sats != null ? Number(n.amount_sats) / 100 : null
    return xec != null && xec > 0
      ? `${VERB[n.type]} · ${xec.toLocaleString()} XEC`
      : VERB[n.type]
  }
  // A comment like is a tip too — append the amount, and name the article when
  // we resolved its title. Never references the (paywalled) comment body.
  if (n.type === 'comment_like') {
    const xec = n.amount_sats != null ? Number(n.amount_sats) / 100 : null
    const base = n.articleTitle
      ? `liked your comment on “${n.articleTitle}”`
      : VERB.comment_like
    return xec != null && xec > 0 ? `${base} · ${xec.toLocaleString()} XEC` : base
  }
  // Unlock/comment name the article when we resolved its title, else fall back
  // to the generic verb ("unlocked your article").
  if (n.type === 'unlock' || n.type === 'comment') {
    if (n.articleTitle) {
      const verb = n.type === 'unlock' ? 'unlocked' : 'commented on'
      return `${verb} “${n.articleTitle}”`
    }
    return VERB[n.type]
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
  // A comment like links to the article's comment thread.
  if (n.type === 'comment_like') {
    return n.articleHref ? `${n.articleHref}#comments` : '#'
  }
  // Unlock/comment link straight to the article (resolved server-side).
  if (n.type === 'unlock' || n.type === 'comment') {
    return n.articleHref ?? '#'
  }
  return n.post_txid ? `/feed/${n.post_txid}` : '#'
}

const POLL_MS = 60_000

/**
 * The header bell: unread-count badge + a dropdown of the signed-in account's
 * recent feed notifications (replies, quotes, likes, reposts, follows). Polls
 * the count on an interval; opening the dropdown marks everything read. Renders
 * nothing for a signed-out viewer.
 *
 * Admin sessions additionally get the AI_SATOSHI review queue folded in: the
 * API returns `agentPending` (absent for everyone else), which adds to the
 * badge and pins a row at the top of the dropdown. It's a standing to-do, not
 * a notification — mark-read never clears it; judging the drafts does.
 * `onAgentPending` reports the count (or null = not admin) up to FeedTopbar,
 * which uses it to reveal the admin "agent" item in the hamburger menu.
 */
export default function FeedNotifications({ signedIn = false, onAgentPending }) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [unread, setUnread] = useState(0)
  const [agentPending, setAgentPending] = useState(null) // null = not an admin session
  const [cursor, setCursor] = useState(null) // next-page cursor, null = no more
  const [loadingMore, setLoadingMore] = useState(false)
  const rootRef = useRef(null)

  // Ref'd so refresh() keeps its stable identity (no re-created intervals).
  const onAgentPendingRef = useRef(onAgentPending)
  useEffect(() => {
    onAgentPendingRef.current = onAgentPending
  }, [onAgentPending])

  // The polling refresh reloads page 1 (and resets the cursor), which would
  // collapse any "Load more" pages the user has opened. Track open state in a
  // ref so the interval can skip the refresh while the dropdown is open.
  const openRef = useRef(open)
  useEffect(() => {
    openRef.current = open
  }, [open])

  // Load (or reload) the first page: newest notifications + unread count.
  // onOpen = the dropdown-opening refresh. While the dropdown is open the badge
  // is pinned at 0 (the reader is looking at the list), so the open-path never
  // writes `unread` — and mark-read is POSTed only AFTER this GET returns.
  // Firing both together let the GET's stale count land after the optimistic
  // clear and resurrect the badge (the "click twice to clear it" bug).
  const refresh = useCallback(async ({ onOpen = false } = {}) => {
    try {
      const res = await fetch('/api/feed/notifications', { cache: 'no-store' })
      if (!res.ok) return
      const data = await res.json()
      const pending = typeof data.agentPending === 'number' ? data.agentPending : null
      setAgentPending(pending)
      onAgentPendingRef.current?.(pending)
      // A poll response that lands after the dropdown opened must not apply:
      // the open dropdown owns the badge (0) and the list ("Load more" pages).
      if (!onOpen && openRef.current) return
      setItems(Array.isArray(data.notifications) ? data.notifications : [])
      setCursor(data.nextCursor ?? null)
      if (onOpen) {
        if ((Number(data.unreadCount) || 0) > 0) {
          fetch('/api/feed/notifications/mark-read', { method: 'POST' })
            // If the dropdown already closed again (quick open/close), a poll
            // may have re-read the pre-commit count — re-sync now that the
            // mark-read has landed.
            .then(() => {
              if (!openRef.current) void refresh()
            })
            .catch(() => {})
        }
      } else {
        setUnread(Number(data.unreadCount) || 0)
      }
    } catch {
      /* best-effort; the bell just won't update this cycle */
    }
  }, [])

  // Append the next page of older notifications (Load more).
  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return
    setLoadingMore(true)
    try {
      const res = await fetch(
        `/api/feed/notifications?before=${encodeURIComponent(cursor)}`,
        { cache: 'no-store' },
      )
      if (res.ok) {
        const data = await res.json()
        const more = Array.isArray(data.notifications) ? data.notifications : []
        setItems((prev) => {
          const seen = new Set(prev.map((n) => n.id))
          return [...prev, ...more.filter((n) => !seen.has(n.id))]
        })
        setCursor(data.nextCursor ?? null)
      }
    } catch {
      /* best-effort; leave the button so the user can retry */
    } finally {
      setLoadingMore(false)
    }
  }, [cursor, loadingMore])

  // Initial load + polling while signed in. The poll skips the reload while the
  // dropdown is open so it can't clobber loaded "Load more" pages.
  useEffect(() => {
    if (!signedIn) return
    void refresh()
    const id = setInterval(() => {
      if (!openRef.current) void refresh()
    }, POLL_MS)
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
        setUnread(0) // the reader is about to see them — badge clears now
        void refresh({ onOpen: true }) // freshen the list, THEN mark read
      }
      return next
    })
  }, [refresh])

  if (!signedIn) return null

  // The badge is unread notifications + pending agent drafts (admin only) —
  // the queue part survives mark-read; only judging the drafts clears it.
  const badgeCount = unread + (agentPending ?? 0)

  return (
    <span className="notifbell" ref={rootRef}>
      <button
        type="button"
        className="notifbtn"
        onClick={toggleOpen}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={badgeCount > 0 ? `Notifications (${badgeCount})` : 'Notifications'}
      >
        <BellIcon />
        {badgeCount > 0 ? (
          <span className="notifbadge">{badgeCount > 99 ? '99+' : badgeCount}</span>
        ) : null}
      </button>
      {open ? (
        <div className="notifpop" role="menu">
          <div className="notifpop-head">Notifications</div>
          {agentPending != null && agentPending > 0 ? (
            <Link
              href="/admin/agent"
              className="notif-agent"
              onClick={() => setOpen(false)}
            >
              <span className="notif-agent-dot" aria-hidden />
              {agentPending} agent draft{agentPending === 1 ? '' : 's'} awaiting review →
            </Link>
          ) : null}
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
                      // The target thread/article is force-dynamic, so the default
                      // prefetch only warms the loading.js shell (instant skeleton).
                      // Upgrade to a FULL data prefetch on hover so the click lands
                      // on rendered content, not a skeleton — the row the reader is
                      // about to click is ready by the time they click it.
                      unstable_dynamicOnHover
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
          {cursor ? (
            <button
              type="button"
              className="notifmore"
              onClick={loadMore}
              disabled={loadingMore}
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          ) : null}
        </div>
      ) : null}
    </span>
  )
}
