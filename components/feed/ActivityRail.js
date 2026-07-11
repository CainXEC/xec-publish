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

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { watchLokadId } from '@/lib/ecash/watchPaymentAddress'
import { FEED_LOKAD_HEX } from '@/lib/feedProtocol'

const POLL_MS = 45_000
// A ws push means the tx just hit the mempool; the server records the action
// a moment later (client confirm + verify). Refetch after this beat.
const NUDGE_DELAY_MS = 2_500

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

// Content snippets read as speech; titles and bylines read as names.
function targetNode(it) {
  if (!it.target) return null
  if (it.kind === 'post' || it.kind === 'reply' || it.kind === 'quote') {
    return <span className="arow-target">“{it.target}”</span>
  }
  return <span className="arow-target">{it.target}</span>
}

export default function ActivityRail() {
  const [items, setItems] = useState(null)
  // The rail only exists at ≥1100px — don't spend fetches or a websocket
  // subscription on phones where it's display:none.
  const [active, setActive] = useState(false)
  const knownIds = useRef(new Set())
  const freshIds = useRef(new Set())
  const nudgeTimer = useRef(null)

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1100px)')
    const update = () => setActive(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/activity', { cache: 'no-store' })
      const data = await res.json()
      if (!data.ok) return
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
    } catch {
      /* best-effort; the next tick covers it */
    }
  }, [])

  useEffect(() => {
    if (!active) return
    void refresh()
    const interval = setInterval(() => void refresh(), POLL_MS)
    // The doorbell: any POWR tx on the network → one delayed refetch. Repeated
    // pushes inside the beat collapse into a single fetch.
    const stopWatch = watchLokadId(
      FEED_LOKAD_HEX,
      () => {
        if (nudgeTimer.current) clearTimeout(nudgeTimer.current)
        nudgeTimer.current = setTimeout(() => void refresh(), NUDGE_DELAY_MS)
      },
      () => void refresh(), // tab foregrounded / socket reconnected
    )
    return () => {
      clearInterval(interval)
      stopWatch()
      if (nudgeTimer.current) clearTimeout(nudgeTimer.current)
    }
  }, [active, refresh])

  return (
    <div className="arail">
      <div className="arail-head">
        <span className="arail-dot" aria-hidden />
        Live on eCash
      </div>
      <p className="arail-sub">Real economic activity — every line links to its on-chain transaction.</p>

      {items === null ? (
        <p className="arail-empty">Listening…</p>
      ) : items.length === 0 ? (
        <p className="arail-empty">Quiet for now — the next post, unlock or mint lands here.</p>
      ) : (
        <ul className="arail-list">
          {items.map((it) => (
            <li key={it.id} className={`arow${freshIds.current.has(it.id) ? ' fresh' : ''}`}>
              <Link href={it.href} className="arow-main">
                <strong className="arow-actor">{it.actor}</strong> {VERB[it.kind] ?? it.kind}{' '}
                {targetNode(it)}
              </Link>
              <span className="arow-meta">
                {it.amountXec != null ? <span className="arow-amt">{fmtXec(it.amountXec)}</span> : null}
                <span className="arow-time">{timeAgo(it.at)}</span>
                {it.final ? (
                  <span className="arow-final" title="Avalanche finalized">✓</span>
                ) : (
                  <span className="arow-pending">finalizing…</span>
                )}
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
          ))}
        </ul>
      )}
    </div>
  )
}
