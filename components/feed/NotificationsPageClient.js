'use client'

import { useCallback, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  earnedLabel,
  timeAgo,
  actorLabel,
  notifText,
  targetHref,
  groupNotifications,
} from '@/lib/notifFormat'

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
function EarnedChip({ items }) {
  const totalSats = items.reduce((sum, n) => sum + (Number(n.amount_sats) || 0), 0)
  const earned = earnedLabel(totalSats > 0 ? totalSats : null)
  return earned ? <span className="notifamt">{earned} · </span> : null
}

export default function NotificationsPageClient({ initialItems, initialCursor, agentPending }) {
  const [items, setItems] = useState(initialItems ?? [])
  const [cursor, setCursor] = useState(initialCursor ?? null)
  const [loadingMore, setLoadingMore] = useState(false)

  const groups = useMemo(() => groupNotifications(items), [items])

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return
    setLoadingMore(true)
    try {
      const res = await fetch(`/api/feed/notifications?before=${encodeURIComponent(cursor)}`, {
        cache: 'no-store',
      })
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
      /* best-effort; the button stays so the user can retry */
    } finally {
      setLoadingMore(false)
    }
  }, [cursor, loadingMore])

  return (
    <>
      {agentPending ? (
        <Link href="/admin/agent" className="notif-agent" style={{ margin: '16px 0 0' }}>
          <span className="notif-agent-dot" aria-hidden />
          {agentPending} agent draft{agentPending === 1 ? '' : 's'} awaiting review →
        </Link>
      ) : null}

      {groups.length === 0 ? (
        <p className="notifempty">Nothing yet.</p>
      ) : (
        <ul className="notifpage-list">
          {groups.map((g) => {
            const head = g.items[0]
            const rowCls = `notifpage-row${g.read ? '' : ' unread'}`
            const content = (
              <>
                <div className="notifpage-top">
                  <span className="notifpage-actors">
                    <EarnedChip items={g.items} />
                    <ActorList items={g.items} verbSuffix={notifText(head)} />
                  </span>
                  <span className="notiftime">{timeAgo(head.created_at)}</span>
                </div>
                {g.items.length === 1 ? <NotifBody n={head} /> : null}
                {/* A like/repost carries no action text of its own, so show the
                    post that was liked/reposted (targetContent) — for a single
                    row or a grouped one. Other types set actionContent instead
                    (rendered by NotifBody above) and never targetContent. */}
                {g.targetContent ? <ClampedBody text={g.targetContent} /> : null}
              </>
            )
            // A grouped 'follow' row has no single target — each name links to
            // its OWN profile instead of the row being one big link.
            if (g.type === 'follow' && g.items.length > 1) {
              return (
                <li key={g.id}>
                  <div className={rowCls}>
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
                      <span className="notiftime">{timeAgo(head.created_at)}</span>
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

      {cursor ? (
        <div className="loadmore">
          <button type="button" className="notifmore" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      ) : null}
    </>
  )
}
