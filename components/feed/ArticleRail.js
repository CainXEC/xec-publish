'use client'
// =============================================================================
//  ArticleRail.js — the desktop LEFT rail: the site's front page.
//
//  An editor-less newspaper whose editor is the chain: a lead story chosen by
//  readers × freshness, LATEST in pure chronology, MOST READ by verified
//  unlock count. The feed is social time; this rail is editorial time.
//
//  Newspaper-ness comes from STRUCTURE (masthead between double rules, a
//  dateline folio with chain stats, hairline-separated entries, a numbered
//  most-read list), not from paper skin — it lives happily in the terminal
//  theme. The one new ingredient: story headlines are SERIF. The site's
//  three-voice type rule: serif = writing, mono = machinery, neon = money.
//
//  Interactions: clicking a headline opens the story; clicking anywhere else
//  on an entry opens a "peek" in place (teaser + Read/Unlock) — one open at
//  a time. Fresh stories (<24h) get the live dot. With no stories at all the
//  rail becomes a house ad: even the empty column-inch sells publishing.
// =============================================================================

import { useEffect, useState } from 'react'
import Link from 'next/link'

const REFRESH_MS = 5 * 60_000 // publishes are rare; the ticker announces them live

const fmtPrice = (p) =>
  p != null && p > 0 ? `${Number(p).toLocaleString()} XEC` : 'free'

function timeAgo(iso) {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000))
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`
  try {
    return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  } catch {
    return ''
  }
}

const isFresh = (iso) => Date.now() - Date.parse(iso) < 24 * 60 * 60 * 1000

function datelineToday() {
  try {
    return new Date()
      .toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
      .toUpperCase()
  } catch {
    return ''
  }
}

// Meta line: byline · price · (readers, else recency). Readers = verified
// on-chain unlocks — circulation, not views.
function metaLine(s, { withLength = false } = {}) {
  const parts = [s.author]
  if (withLength && s.readMinutes) parts.push(`${s.readMinutes} min`)
  parts.push(fmtPrice(s.priceXec))
  parts.push(s.readers > 0 ? `${s.readers} reader${s.readers === 1 ? '' : 's'}` : timeAgo(s.at))
  return parts
}

function Meta({ story, withLength }) {
  const parts = metaLine(story, { withLength })
  return (
    <div className="np-meta">
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 ? ' · ' : ''}
          {String(p).endsWith('XEC') ? <span className="np-price">{p}</span> : p}
        </span>
      ))}
    </div>
  )
}

function PeekButtons({ story }) {
  const paid = story.priceXec != null && story.priceXec > 0
  return (
    <div className="np-btns">
      <Link className="np-btn" href={`/posts/${story.slug}`}>Read →</Link>
      {paid ? (
        <Link className="np-btn unlock" href={`/posts/${story.slug}`}>
          Unlock · {Number(story.priceXec).toLocaleString()} XEC
        </Link>
      ) : null}
    </div>
  )
}

function Entry({ story, open, onToggle }) {
  return (
    <div
      className={`np-entry${open ? ' open' : ''}`}
      onClick={(e) => {
        // The headline navigates; the rest of the entry toggles the peek.
        if (e.target.closest('a')) return
        onToggle()
      }}
    >
      <Link className="np-hl" href={`/posts/${story.slug}`}>
        <span className="np-serif np-entry-h">
          {isFresh(story.at) ? <span className="np-dot" aria-hidden /> : null}
          {story.title}
        </span>
      </Link>
      {open ? (
        <>
          {story.teaser ? <p className="np-teaser">{story.teaser}</p> : null}
          <PeekButtons story={story} />
        </>
      ) : (
        <Meta story={story} />
      )}
    </div>
  )
}

export default function ArticleRail() {
  const [data, setData] = useState(null)
  const [openId, setOpenId] = useState(null)
  // The front page only exists at ≥1400px — don't fetch where it can't show.
  const [active, setActive] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1400px)')
    const update = () => setActive(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    if (!active) return
    let alive = true
    const load = async () => {
      try {
        const res = await fetch('/api/articles/rail', { cache: 'no-store' })
        const j = await res.json()
        if (alive && j.ok) setData(j)
      } catch {
        /* the rail just stays as it was */
      }
    }
    void load()
    const id = setInterval(load, REFRESH_MS)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [active])

  const toggle = (id) => setOpenId((cur) => (cur === id ? null : id))

  const lead = data?.lead ?? null
  const latest = data?.latest ?? []
  const mostRead = data?.mostRead ?? []

  return (
    <div className="npaper">
      <div className="np-mast">The front page</div>
      <div className="np-date">
        {datelineToday()}
        {data ? ` — ${Number(data.minted).toLocaleString()} handles minted · ${Number(data.stories).toLocaleString()} ${data.stories === 1 ? 'story' : 'stories'}` : ''}
      </div>

      {data === null ? (
        <p className="np-empty">Setting the type…</p>
      ) : !lead ? (
        <p className="np-empty">The presses are warm and the front page is blank.</p>
      ) : (
        <>
          <div className="np-kick">Lead story</div>
          <Link className="np-hl" href={`/posts/${lead.slug}`}>
            <span className="np-serif np-lead-h">
              {isFresh(lead.at) ? <span className="np-dot" aria-hidden /> : null}
              {lead.title}
            </span>
          </Link>
          {lead.teaser ? <p className="np-teaser np-lead-t">{lead.teaser}</p> : null}
          <Meta story={lead} withLength />

          {latest.length > 0 ? (
            <>
              <div className="np-sec">Latest</div>
              {latest.map((s) => (
                <Entry key={s.id} story={s} open={openId === s.id} onToggle={() => toggle(s.id)} />
              ))}
            </>
          ) : null}

          {mostRead.length > 0 ? (
            <>
              <div className="np-sec">Most read · 7 days</div>
              <div className="np-ranks">
                {mostRead.map((s, i) => (
                  <Link className="np-rank" key={s.id} href={`/posts/${s.slug}`}>
                    <span className="np-rank-n">{i + 1}</span>
                    <span className="np-serif np-rank-h">{s.title}</span>
                    <span className="np-rank-c">{s.readers7d}</span>
                  </Link>
                ))}
              </div>
            </>
          ) : null}
        </>
      )}

      <div className="np-foot">
        Your story belongs here — <Link href="/dashboard">publish for 100 XEC</Link>
      </div>
    </div>
  )
}
