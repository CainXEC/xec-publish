'use client'
// =============================================================================
//  ArticleRail.js — the desktop LEFT rail: the site's front page.
//
//  An editor-less newspaper whose editor is the chain: a LEAD story chosen by
//  breadth × freshness × a sublinear price nudge (readers dominate; a pricier
//  piece only edges an equally-read cheaper one), then MORE STORIES in pure
//  chronology. The feed is social time; this rail is editorial time.
//
//  Newspaper-ness comes from STRUCTURE (masthead between double rules, a
//  dateline folio, a hero lead, hairline-separated entries below), not from
//  paper skin — it lives happily in the terminal theme. The one new
//  ingredient: story headlines are SERIF. The site's
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

// Live masthead dateline: the date plus a ticking clock (with seconds). Its own
// component so only this line re-renders each second, not the whole rail. The
// clock is null until mount, so the server renders a blank line and there's no
// hydration mismatch from server-vs-client time.
function FrontPageClock() {
  const [now, setNow] = useState(null)

  useEffect(() => {
    // Prime on the next tick (not synchronously in the effect body) so the
    // clock fills in immediately after mount without a cascading render.
    const prime = setTimeout(() => setNow(new Date()), 0)
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => {
      clearTimeout(prime)
      clearInterval(id)
    }
  }, [])

  if (!now) return <div className="np-date">&nbsp;</div>

  let date = ''
  let time = ''
  try {
    date = now
      .toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
      .toUpperCase()
    time = now.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    /* leave blank */
  }

  return (
    <div className="np-date">
      {date}
      {time ? (
        <>
          {date ? ' · ' : ''}
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{time}</span>
        </>
      ) : null}
    </div>
  )
}

// Meta line: byline · price · (readers, else recency). Readers = verified
// on-chain unlocks — circulation, not views.
function metaLine(s) {
  const parts = [s.author]
  parts.push(fmtPrice(s.priceXec))
  parts.push(s.readers > 0 ? `${s.readers} reader${s.readers === 1 ? '' : 's'}` : timeAgo(s.at))
  return parts
}

function Meta({ story }) {
  const parts = metaLine(story)
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

function PeekButtons({ story, onOpen }) {
  const paid = story.priceXec != null && story.priceXec > 0
  return (
    <div className="np-btns">
      <Link
        className="np-btn"
        href={`/posts/${story.slug}`}
        onClick={onOpen ? (e) => onOpen(e, story.slug) : undefined}
        data-no-navprogress={onOpen ? '' : undefined}
      >
        Read →
      </Link>
      {paid ? (
        // Unlock always goes to the story's own page — the payment flow
        // lives there, and a reading pane can't finish a Cashtab round-trip.
        <Link className="np-btn unlock" href={`/posts/${story.slug}`}>
          Unlock · {Number(story.priceXec).toLocaleString()} XEC
        </Link>
      ) : null}
    </div>
  )
}

// The lead: a full newspaper hero — big serif headline, teaser, a meta line
// that surfaces earnings alongside readers, and the Read/Unlock actions inline
// (no click-to-peek; the lead is already open).
function Lead({ story, now, onOpen }) {
  const parts = [story.author, fmtPrice(story.priceXec)]
  parts.push(story.readers > 0 ? `${story.readers} reader${story.readers === 1 ? '' : 's'}` : timeAgo(story.at))
  if (story.earnedXec > 0) parts.push(`${Number(story.earnedXec).toLocaleString()} XEC earned`)
  return (
    <div className={`np-lead${now ? ' now' : ''}`}>
      <Link
        className="np-lead-hl"
        href={`/posts/${story.slug}`}
        onClick={onOpen ? (e) => onOpen(e, story.slug) : undefined}
        data-no-navprogress={onOpen ? '' : undefined}
      >
        <span className="np-serif np-lead-h">
          {isFresh(story.at) ? <span className="np-dot" aria-hidden /> : null}
          {story.title}
        </span>
      </Link>
      {story.teaser ? <p className="np-lead-teaser">{story.teaser}</p> : null}
      <div className="np-lead-meta">
        {parts.map((p, i) => (
          <span key={i}>
            {i > 0 ? ' · ' : ''}
            {String(p).endsWith('XEC') ? (
              <span className="np-price">{p}</span>
            ) : String(p).endsWith('earned') ? (
              <span className="np-earned">{p}</span>
            ) : (
              p
            )}
          </span>
        ))}
      </div>
      <PeekButtons story={story} onOpen={onOpen} />
    </div>
  )
}

function Entry({ story, open, now, onToggle, onOpen }) {
  return (
    <div
      className={`np-entry${open ? ' open' : ''}${now ? ' now' : ''}`}
      onClick={(e) => {
        // The headline navigates; the rest of the entry toggles the peek.
        if (e.target.closest('a')) return
        onToggle()
      }}
    >
      <Link
        className="np-hl"
        href={`/posts/${story.slug}`}
        onClick={onOpen ? (e) => onOpen(e, story.slug) : undefined}
        data-no-navprogress={onOpen ? '' : undefined}
      >
        <span className="np-serif np-entry-h">
          {isFresh(story.at) ? <span className="np-dot" aria-hidden /> : null}
          {story.title}
        </span>
      </Link>
      {open ? (
        <>
          {story.teaser ? <p className="np-teaser">{story.teaser}</p> : null}
          <PeekButtons story={story} onOpen={onOpen} />
        </>
      ) : (
        <Meta story={story} />
      )}
    </div>
  )
}

export default function ArticleRail({ minWidth = 1400, currentSlug = null, onOpenStory = null }) {
  const [data, setData] = useState(null)
  const [openId, setOpenId] = useState(null)
  // The front page only exists above the host page's breakpoint — don't
  // fetch where it can't show.
  const [active, setActive] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${minWidth}px)`)
    const update = () => setActive(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [minWidth])

  // On an article page, mark the story being read wherever it appears.
  const isNow = (s) => Boolean(currentSlug) && s.slug === currentSlug

  // Home page: stories open in the center reading pane instead of navigating.
  // Modifier clicks (new tab, etc.) fall through to the real /posts/… URL.
  const interceptOpen = onOpenStory
    ? (e, slug) => {
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1) return
        e.preventDefault()
        onOpenStory(slug)
      }
    : null

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
  const more = data?.more ?? []

  return (
    <div className="npaper">
      <div className="np-mast">The front page</div>
      <FrontPageClock />

      {data === null ? (
        <p className="np-empty">Setting the type…</p>
      ) : !lead && more.length === 0 ? (
        <p className="np-empty">The presses are warm and the front page is blank.</p>
      ) : (
        <>
          {lead ? <Lead story={lead} now={isNow(lead)} onOpen={interceptOpen} /> : null}

          {more.length > 0 ? (
            <>
              <div className="np-sec">More stories</div>
              {more.map((s) => (
                <Entry
                  key={s.id}
                  story={s}
                  open={openId === s.id}
                  now={isNow(s)}
                  onToggle={() => toggle(s.id)}
                  onOpen={interceptOpen}
                />
              ))}
            </>
          ) : null}
        </>
      )}

      <div className="np-foot">
        Write your story. <Link href="/dashboard">Publish for 100 XEC</Link>.
      </div>
    </div>
  )
}
