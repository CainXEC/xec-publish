'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  amountLabelForType,
  timeAgo,
  actorLabel,
  notifText,
  targetHref,
  groupNotifications,
  notifGlyph,
  isConversationalNotif,
} from '@/lib/notifFormat'
import { broadcastNotificationsRead } from '@/lib/notifSync'

// Types that can carry their own full text inline (never grouped — see
// GROUPABLE_TYPES in lib/notifFormat). A FEED mention shows the post you were
// tagged in; an article mention has no inline body (NotifBody renders nothing).
const HAS_BODY = new Set(['reply', 'quote', 'comment', 'mention'])

// The actor's name, tinted with their chosen handle color (--hc) when they show
// a handle — matching the feed/profile/thread. A raw-address actor gets no tint.
function ActorName({ n }) {
  const isHandle = typeof n?.actor_identity === 'string' && n.actor_identity.startsWith('@')
  return (
    <strong
      className="notifpage-name"
      style={isHandle && n.actor_color ? { '--hc': n.actor_color } : undefined}
    >
      {actorLabel(n.actor_identity)}
    </strong>
  )
}

// Grouped rows name the MOST RECENT actor (items are newest-first) and collapse
// everyone else into a count: "A liked", "A and 1 other liked", "A and 4 others
// liked". One name keeps the line short and puts the freshest actor first — the
// summed tip (EarnedChip) and the target post (targetContent) are shown once for
// the whole group, so the individual names add little.
const MAX_NAMED_ACTORS = 1

function ActorList({ items, verbSuffix }) {
  const named = items.slice(0, MAX_NAMED_ACTORS)
  const rest = items.length - named.length
  const tail = rest > 0 ? `${rest} other${rest === 1 ? '' : 's'}` : null
  const partCount = named.length + (tail ? 1 : 0)
  return (
    <>
      {named.map((n, i) => (
        <span key={n.id}>
          {i > 0 ? (i === partCount - 1 ? ' and ' : ', ') : ''}
          <ActorName n={n} />
        </span>
      ))}
      {tail ? (
        <span className="notifpage-more">
          {named.length > 0 ? ' and ' : ''}
          {tail}
        </span>
      ) : null}{' '}
      {verbSuffix}
    </>
  )
}

// Same clamp length as a feed post's own "Show more" (FeedPost.js FEED_CLAMP_CHARS)
// — a reply/comment shown here is the same kind of content, so it should read
// the same amount before asking to expand.
const BODY_CLAMP_CHARS = 280

/** The boxed quoted-text body (a reply/comment/quote's own words, or a liked/
 *  reposted target's text) — the one "harness" left on this page. Long text
 *  clamps with a Show more/less toggle, matching the feed's own pattern. The
 *  whole row is a Link (see below), so the button must preventDefault +
 *  stopPropagation or clicking it would navigate away instead of expanding. */
function ClampedBody({ text }) {
  const [expanded, setExpanded] = useState(false)
  if (!text) return null
  const isLong = text.length > BODY_CLAMP_CHARS
  const shown = !isLong || expanded ? text : `${text.slice(0, BODY_CLAMP_CHARS).trimEnd()}…`
  return (
    <p className="notifpage-body">
      {shown}
      {isLong ? (
        <button
          type="button"
          className="showmore"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setExpanded((s) => !s)
          }}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      ) : null}
    </p>
  )
}

function NotifBody({ n }) {
  if (!HAS_BODY.has(n.type)) return null
  // Text resolved -> show it (clamped). A pointer that resolved to nothing
  // (deleted/missing) -> the "gone" note. Neither (an older notification with no
  // stored pointer) -> nothing; the verb line already reads fine on its own.
  if (n.actionContent) return <ClampedBody text={n.actionContent} />
  if (n.actionGone) {
    // "mention" -> the POST they were tagged in; "quote"/"reply"/"comment" name
    // themselves.
    const noun = n.type === 'quote' ? 'quote' : n.type === 'mention' ? 'post' : n.type
    return <p className="notifpage-body gone">This {noun} is no longer available.</p>
  }
  return null
}

/** The TOTAL earned across a group's items (a single item's own amount, for an
 *  ungrouped row) — never just the first item's, which would misattribute a
 *  shared tip total to one actor when several people tipped the same post. */
function EarnedChip({ items, type }) {
  const totalSats = items.reduce((sum, n) => sum + (Number(n.amount_sats) || 0), 0)
  // Tips pay the recipient 100% (gross); every other paid action nets the 6% fee.
  const earned = amountLabelForType(type, totalSats > 0 ? totalSats : null)
  return earned ? <span className="notifamt">{earned} · </span> : null
}

// The two views. 'all' is everything; 'mentions' is the respond-worthy types
// (reply/quote/mention/comment), server-filtered so it pages over only those.
const TABS = [
  { key: 'all', label: 'All notifications' },
  { key: 'mentions', label: 'Mentions', filter: 'mentions' },
]

export default function NotificationsPageClient({ initialItems, initialCursor, agentPending }) {
  const [tab, setTab] = useState('all')
  // Per-tab list + keyset cursor + whether it's been fetched. 'all' is seeded by
  // the SSR page; 'mentions' lazy-loads (server-filtered) the first time it's
  // opened, so flipping between tabs never refetches.
  const [tabs, setTabs] = useState({
    all: { items: initialItems ?? [], cursor: initialCursor ?? null, loaded: true },
    mentions: { items: [], cursor: null, loaded: false },
  })
  const [loadingMore, setLoadingMore] = useState(false)
  const [switching, setSwitching] = useState(false)

  const active = tabs[tab]
  const groups = useMemo(() => groupNotifications(active.items), [active.items])

  const patchTab = useCallback((key, patch) => {
    setTabs((t) => ({
      ...t,
      [key]: typeof patch === 'function' ? patch(t[key]) : { ...t[key], ...patch },
    }))
  }, [])

  // One fetch for both tabs — the Mentions tab just adds ?filter=mentions.
  const fetchNotifs = useCallback(async (key, before) => {
    const params = new URLSearchParams()
    if (before) params.set('before', before)
    const filter = TABS.find((t) => t.key === key)?.filter
    if (filter) params.set('filter', filter)
    const qs = params.toString()
    const res = await fetch(`/api/feed/notifications${qs ? `?${qs}` : ''}`, { cache: 'no-store' })
    if (!res.ok) throw new Error('Failed to load notifications')
    return res.json()
  }, [])

  // The server already marked everything read before this component ever
  // mounted (app/notifications/page.js runs markFeedNotificationsRead during
  // its own render) — broadcast that so any OTHER open tab's bell clears its
  // badge immediately instead of waiting out its next ~60s poll.
  useEffect(() => {
    broadcastNotificationsRead()
  }, [])

  const selectTab = useCallback(
    async (key) => {
      setTab(key)
      if (tabs[key].loaded || switching) return
      setSwitching(true)
      try {
        const data = await fetchNotifs(key, null)
        patchTab(key, {
          items: Array.isArray(data.notifications) ? data.notifications : [],
          cursor: data.nextCursor ?? null,
          loaded: true,
        })
      } catch {
        /* leave it unloaded so re-tapping the tab retries */
      } finally {
        setSwitching(false)
      }
    },
    [tabs, switching, fetchNotifs, patchTab],
  )

  // Pull in notifications that arrived AFTER this page loaded and prepend them to
  // the ACTIVE tab (with its filter). The page renders its list once (server-side)
  // and otherwise only appends OLDER rows via loadMore, so without this a
  // notification that lands while you're sitting here — flagged by the bell's red
  // badge — would never show. Fired by the header bell's click, since clicking it
  // while already on /notifications is a no-op navigation that can't refetch SSR.
  const refreshLatest = useCallback(async () => {
    try {
      const data = await fetchNotifs(tab, null)
      const latest = Array.isArray(data.notifications) ? data.notifications : []
      patchTab(tab, (cur) => {
        const seen = new Set(cur.items.map((n) => n.id))
        const fresh = latest.filter((n) => !seen.has(n.id))
        // API is newest-first, so new rows lead — prepend, preserving order.
        return fresh.length ? { ...cur, items: [...fresh, ...cur.items] } : cur
      })
      // Clear the DB unread so the bell badge doesn't re-appear on its next poll
      // (unreadCount is global, so this holds on either tab).
      if (Number(data.unreadCount) > 0) {
        fetch('/api/feed/notifications/mark-read', { method: 'POST' }).catch(() => {})
      }
    } catch {
      /* best-effort; the badge stays and the next click retries */
    }
  }, [tab, fetchNotifs, patchTab])

  useEffect(() => {
    const onRefresh = () => void refreshLatest()
    window.addEventListener('notifications:refresh', onRefresh)
    return () => window.removeEventListener('notifications:refresh', onRefresh)
  }, [refreshLatest])

  const loadMore = useCallback(async () => {
    const cur = tabs[tab]
    if (!cur.cursor || loadingMore) return
    setLoadingMore(true)
    try {
      const data = await fetchNotifs(tab, cur.cursor)
      const more = Array.isArray(data.notifications) ? data.notifications : []
      patchTab(tab, (t) => {
        const seen = new Set(t.items.map((n) => n.id))
        return {
          ...t,
          items: [...t.items, ...more.filter((n) => !seen.has(n.id))],
          cursor: data.nextCursor ?? null,
        }
      })
    } catch {
      /* best-effort; the button stays so the user can retry */
    } finally {
      setLoadingMore(false)
    }
  }, [tab, tabs, loadingMore, fetchNotifs, patchTab])

  return (
    <>
      {agentPending ? (
        <Link href="/admin/agent" className="notif-agent" style={{ margin: '16px 0 0' }}>
          <span className="notif-agent-dot" aria-hidden />
          {agentPending} agent draft{agentPending === 1 ? '' : 's'} awaiting review →
        </Link>
      ) : null}

      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={`tab${tab === t.key ? ' on' : ''}`}
            onClick={() => void selectTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {switching && !active.loaded ? (
        <p className="notifempty">Loading…</p>
      ) : groups.length === 0 ? (
        <p className="notifempty">{tab === 'mentions' ? 'No mentions yet.' : 'Nothing yet.'}</p>
      ) : (
        <ul className="notifpage-list">
          {groups.map((g) => {
            const head = g.items[0]
            // Conversational notifications (reply/quote/mention/comment) — someone
            // talking TO you — get a cyan accent + brighter text; reactions/reposts
            // stay a dim nod. A leading glyph makes every row scan at a glance.
            const convo = isConversationalNotif(g.type)
            const rowCls = `notifpage-row${g.read ? '' : ' unread'}${convo ? ' convo' : ''}`
            const content = (
              <>
                <span className="notifpage-glyph" aria-hidden>{notifGlyph(g.type)}</span>
                <div className="notifpage-main">
                  <div className="notifpage-top">
                    <span className="notifpage-actors">
                      <EarnedChip items={g.items} type={g.type} />
                      <ActorList items={g.items} verbSuffix={notifText(head)} />
                    </span>
                    <span className="notiftime" suppressHydrationWarning>{timeAgo(head.created_at)}</span>
                  </div>
                  {g.items.length === 1 ? <NotifBody n={head} /> : null}
                  {/* A like/repost carries no action text of its own, so show the
                      post that was liked/reposted (targetContent) — for a single
                      row or a grouped one. Other types set actionContent instead
                      (rendered by NotifBody above) and never targetContent. */}
                  {g.targetContent ? <ClampedBody text={g.targetContent} /> : null}
                </div>
              </>
            )
            // A grouped 'follow' row has no single target — each name links to
            // its OWN profile instead of the row being one big link.
            if (g.type === 'follow' && g.items.length > 1) {
              return (
                <li key={g.id}>
                  <div className={rowCls}>
                    <span className="notifpage-glyph" aria-hidden>{notifGlyph(g.type)}</span>
                    <div className="notifpage-main">
                    <div className="notifpage-top">
                      <span className="notifpage-actors">
                        {(() => {
                          const named = g.items.slice(0, MAX_NAMED_ACTORS)
                          const rest = g.items.length - named.length
                          return (
                            <>
                              {named.map((n, i) => (
                                <span key={n.id}>
                                  {i > 0 ? (i === named.length - 1 && rest === 0 ? ' and ' : ', ') : ''}
                                  <Link href={targetHref(n)}>
                                    <ActorName n={n} />
                                  </Link>
                                </span>
                              ))}
                              {rest > 0 ? (
                                <span className="notifpage-more">
                                  {' '}and {rest} other{rest === 1 ? '' : 's'}
                                </span>
                              ) : null}
                            </>
                          )
                        })()}{' '}
                        followed you
                      </span>
                      <span className="notiftime" suppressHydrationWarning>{timeAgo(head.created_at)}</span>
                    </div>
                    </div>
                  </div>
                </li>
              )
            }
            return (
              <li key={g.id}>
                <Link href={targetHref(head)} className={rowCls} unstable_dynamicOnHover>
                  {content}
                </Link>
              </li>
            )
          })}
        </ul>
      )}

      {active.cursor ? (
        <div className="loadmore">
          <button type="button" className="notifmore" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      ) : null}
    </>
  )
}
