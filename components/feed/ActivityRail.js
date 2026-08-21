'use client'
// =============================================================================
//  ActivityRail.js — the desktop right rail: a live ticker of verified
//  on-chain economic activity (posts, replies, quotes, likes, tips, reposts,
//  article unlocks, publishes, handle mints).
//
//  Truthful by construction: rows come from /api/activity, which serves only
//  events the server has already verified on-chain — and every line carries
//  its txid, linking to the eCash explorer. This rail is the anti-"Trends":
//  nothing here can be faked, because every entry cost real money.
//
//  Liveness = the site's established "websocket nudges, server is authority"
//  pattern: one shared Chronik socket subscribes to the POWR LOKAD ID, so ANY
//  protocol action anywhere on the network rings a doorbell that refetches
//  the endpoint (after a short beat, giving the server time to record the
//  action). A 45s interval poll and tab-wake refresh cover every gap; if the
//  socket never opens, the rail still works on the poll alone.
// =============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { watchLokadId } from '@/lib/ecash/watchPaymentAddress'
import { FEED_LOKAD_HEX } from '@/lib/feedProtocol'

const POLL_MS = 45_000
// A ws push means the tx just hit the mempool; the server records the action
// a moment later (client confirm + verify). Refetch after this beat…
const NUDGE_DELAY_MS = 1_200
// …and once more shortly after: catches actions the server recorded slightly
// late, so a just-happened row doesn't wait for the next 45s poll to appear.
const NUDGE_FOLLOWUP_MS = 6_500

const VERB = {
  post: 'posted',
  reply: 'replied',
  quote: 'quoted',
  like: 'liked',
  tip: 'tipped',
  repost: 'reposted',
  unlock: 'unlocked',
  publish: 'published',
  mint: 'minted',
  comment: 'commented on',
  comment_like: 'liked a comment on',
  forum: 'created',
}

const fmtXec = (n) => `${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })} XEC`

function timeAgo(iso) {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000))
  if (s < 45) return 'now'
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`
  try {
    return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  } catch {
    return ''
  }
}

// Content snippets read as speech; titles and bylines read as names. Likes,
// tips and reposts now reference the target POST's content, so they quote it
// too — unless it fell back to a byline (@handle / short address) for a post
// with no text, which reads as a name. Comments are NOT quoted: their target is
// the article TITLE (the paywalled comment body never leaves the server), so it
// reads "commented on <Title>", like unlock/publish.
const looksLikeName = (s) => /^@/.test(s) || /^[a-z0-9]{8}…[a-z0-9]{4}$/.test(s)
function targetNode(it) {
  if (!it.target) return null
  const quotedKind =
    it.kind === 'post' || it.kind === 'reply' || it.kind === 'quote' ||
    it.kind === 'like' || it.kind === 'tip' || it.kind === 'repost'
  if (quotedKind && !looksLikeName(it.target)) {
    return <span className="arow-target">“{it.target}”</span>
  }
  return <span className="arow-target">{it.target}</span>
}

export default function ActivityRail({
  minWidth = 1100,
  heading = 'Live on proofofwriting',
  sub = 'Real economic activity — every line links to its on-chain transaction.',
  emptyText = 'Quiet for now — the next post, unlock or mint lands here.',
  // Author-profile scoping: { authorId, address } narrows the stream to
  // events touching one author (their posts, value they received, their
  // articles' unlocks/publishes). Null = the site-wide firehose.
  scope = null,
  // Host pages with a center reading pane (the home feed): thread rows open
  // in place instead of navigating. Modifier clicks still open the page.
  onOpenThread = null,
  // Same idea for ARTICLE rows (unlock/publish/comment/comment_like): open the
  // story in the reading pane instead of navigating to its page. Only passed
  // where a pane exists; elsewhere article rows navigate as before.
  onOpenArticle = null,
}) {
  const [items, setItems] = useState(null)
  // The viewer's block set (accounts they blocked + who blocked them). The
  // /api/activity firehose is viewer-NEUTRAL and CDN-cached, so it can't filter
  // per viewer; we hide blocked accounts' rows here, on top of the shared payload
  // — the same overlay pattern the For You feed uses (viewer-state). Empty for
  // signed-out viewers. Kept in STATE (not a ref) so a live block/unblock
  // re-filters immediately; the raw `items` still hold every row, so an unblock
  // re-shows them with no refetch.
  const [blockedIds, setBlockedIds] = useState(() => new Set())
  // Live "on the site right now" count, broadcast by the site-wide
  // PresenceHeartbeat via a window event — no request of our own.
  const [online, setOnline] = useState(null)
  // The rail only exists above the host page's breakpoint (1100px on the
  // feed, wider on the article page) — don't spend fetches or a websocket
  // subscription where it's display:none.
  const [active, setActive] = useState(false)
  const knownIds = useRef(new Set())
  const freshIds = useRef(new Set())
  const nudgeTimer = useRef(null)
  const followupTimer = useRef(null)
  const lastRefreshAt = useRef(0)

  useEffect(() => {
    const onPresence = (e) => {
      const n = e.detail
      if (typeof n === 'number' && Number.isFinite(n) && n >= 0) setOnline(n)
    }
    window.addEventListener('pow:presence', onPresence)
    // Paint the last-known count immediately (it survives in-app navigation on
    // window), then ask the site-wide heartbeat to refresh it — otherwise a rail
    // mounted after a client-side nav would wait up to one 25s beat before any
    // number appears.
    if (typeof window.__powPresenceCount === 'number') setOnline(window.__powPresenceCount)
    window.dispatchEvent(new Event('pow:presence-request'))
    return () => window.removeEventListener('pow:presence', onPresence)
  }, [])

  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${minWidth}px)`)
    const update = () => setActive(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [minWidth])

  // Load the viewer's block set once the rail is live (signed-out → empty), and
  // keep it current when they block/unblock someone in-session — FeedPost's menu
  // broadcasts pow:block-changed on window, the same channel presence uses. One
  // fetch, re-used across every poll/nudge; the block set changes rarely.
  useEffect(() => {
    if (!active) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/feed/block', { cache: 'no-store' })
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled && Array.isArray(data?.ids)) setBlockedIds(new Set(data.ids))
      } catch {
        /* best-effort — the firehose still renders unfiltered without it */
      }
    })()
    const onChange = (e) => {
      const { accountId, blocked } = e.detail ?? {}
      if (typeof accountId !== 'string' || !accountId) return
      setBlockedIds((cur) => {
        const next = new Set(cur)
        if (blocked === false) next.delete(accountId)
        else next.add(accountId)
        return next
      })
    }
    window.addEventListener('pow:block-changed', onChange)
    return () => {
      cancelled = true
      window.removeEventListener('pow:block-changed', onChange)
    }
  }, [active])

  // Returns true on a clean load, false on any failure — the caller uses that to
  // retry a FAILED first load quickly instead of stranding the rail on
  // "Listening…" until the 45s poll (the /api/activity endpoint can 500 on a
  // transient DB blip / cold start; that used to require a manual refresh).
  const refresh = useCallback(async () => {
    lastRefreshAt.current = Date.now()
    try {
      const params = new URLSearchParams()
      if (scope?.authorId) params.set('authorId', scope.authorId)
      if (scope?.address) params.set('address', scope.address)
      const qs = params.toString()
      const res = await fetch(`/api/activity${qs ? `?${qs}` : ''}`, { cache: 'no-store' })
      if (!res.ok) return false
      const data = await res.json()
      if (!data.ok) return false
      const next = data.items ?? []
      // Mark rows we haven't seen before so they flash in (skipped on the
      // very first load — the backfill shouldn't strobe).
      if (knownIds.current.size > 0) {
        const fresh = new Set()
        for (const it of next) if (!knownIds.current.has(it.id)) fresh.add(it.id)
        freshIds.current = fresh
      }
      knownIds.current = new Set(next.map((it) => it.id))
      setItems(next)
      return true
    } catch {
      return false
    }
  }, [scope?.authorId, scope?.address])

  useEffect(() => {
    if (!active) return
    let stopped = false
    // Fast-retry the FIRST load until it succeeds (2s, 4s, 8s… capped), so a
    // transient endpoint failure recovers on its own in seconds rather than
    // hanging on "Listening…" until the next 45s poll. Steady-state polling
    // below is unaffected — this chain self-terminates on the first success.
    let retryTimer = null
    let retryDelay = 2_000
    const RETRY_MAX = 20_000
    const initialLoad = async () => {
      if (stopped) return
      const ok = await refresh()
      if (!ok && !stopped) {
        retryTimer = setTimeout(initialLoad, retryDelay)
        retryDelay = Math.min(retryDelay * 2, RETRY_MAX)
      }
    }
    void initialLoad()
    const interval = setInterval(() => void refresh(), POLL_MS)
    // The doorbell: any POWR tx on the network → one delayed refetch. Repeated
    // pushes inside the beat collapse into a single fetch.
    const stopWatch = watchLokadId(
      FEED_LOKAD_HEX,
      () => {
        if (nudgeTimer.current) clearTimeout(nudgeTimer.current)
        if (followupTimer.current) clearTimeout(followupTimer.current)
        nudgeTimer.current = setTimeout(() => void refresh(), NUDGE_DELAY_MS)
        followupTimer.current = setTimeout(() => void refresh(), NUDGE_FOLLOWUP_MS)
      },
      () => {
        // Debounced: a real return still refreshes at once, but rapid focus
        // toggling collapses into one fetch.
        if (Date.now() - lastRefreshAt.current < 15_000) return
        void refresh()
      },
    )
    return () => {
      stopped = true
      if (retryTimer) clearTimeout(retryTimer)
      clearInterval(interval)
      stopWatch()
      if (nudgeTimer.current) clearTimeout(nudgeTimer.current)
      if (followupTimer.current) clearTimeout(followupTimer.current)
    }
  }, [active, refresh])

  // Hide rows from accounts the viewer has blocked — both the actor AND, for a
  // row that surfaces another post's content (a repost of a blocked account's
  // post), that target's author. Rows with no resolvable account (mints,
  // stray-wallet unlocks — both ids null) always show.
  const visibleItems = useMemo(
    () =>
      items === null
        ? null
        : items.filter(
            (it) =>
              !blockedIds.has(it.actorAccountId) && !blockedIds.has(it.targetAccountId),
          ),
    [items, blockedIds],
  )

  return (
    <div className="arail">
      <div className="arail-head">
        <span className="arail-dot" aria-hidden />
        {heading}
        {online != null ? (
          <span className="arail-online" title="On the site right now">
            {online.toLocaleString()}
          </span>
        ) : null}
      </div>
      <p className="arail-sub">{sub}</p>

      {visibleItems === null ? (
        <p className="arail-empty">Listening…</p>
      ) : visibleItems.length === 0 ? (
        <p className="arail-empty">{emptyText}</p>
      ) : (
        <ul className="arail-list">
          {visibleItems.map((it) => {
            // Rows open in the reading pane where the host provides one: feed
            // threads via onOpenThread, articles via onOpenArticle. A row is one
            // or the other, never both. Modifier / middle clicks fall through to
            // the real href (new tab, etc.); everything else opens in place.
            const threadTxid =
              onOpenThread && it.href?.startsWith('/feed/') ? it.href.slice('/feed/'.length) : null
            const articleSlug = onOpenArticle && it.slug ? it.slug : null
            const openInPane =
              threadTxid || articleSlug
                ? (e) => {
                    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1) return
                    e.preventDefault()
                    if (threadTxid) onOpenThread(threadTxid)
                    else onOpenArticle(articleSlug)
                  }
                : undefined
            return (
            <li key={it.id} className={`arow${freshIds.current.has(it.id) ? ' fresh' : ''}`}>
              <div className="arow-main">
                {(() => {
                  // Tint the actor with their chosen handle color (--hc) when they
                  // show a @handle — matching the feed/thread/profile.
                  const hc =
                    it.color && String(it.actor).startsWith('@') ? { '--hc': it.color } : undefined
                  return it.actorHref ? (
                    <Link href={it.actorHref} className="arow-actor arow-actor-link" style={hc}>
                      {it.actor}
                    </Link>
                  ) : (
                    <strong className="arow-actor" style={hc}>
                      {it.actor}
                    </strong>
                  )
                })()}{' '}
                <Link
                  href={it.href}
                  className="arow-say"
                  onClick={openInPane}
                  data-no-navprogress={openInPane ? true : undefined}
                >
                  {VERB[it.kind] ?? it.kind} {targetNode(it)}
                </Link>
              </div>
              <span className="arow-meta">
                {it.amountXec != null ? <span className="arow-amt">{fmtXec(it.amountXec)}</span> : null}
                <span className="arow-time">{timeAgo(it.at)}</span>
                {it.txid ? (
                  <a
                    className="arow-tx"
                    href={`https://explorer.e.cash/tx/${it.txid}`}
                    target="_blank"
                    rel="noreferrer"
                    title="View the transaction on the eCash explorer"
                  >
                    tx ↗
                  </a>
                ) : null}
              </span>
            </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
