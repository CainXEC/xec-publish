'use client'
// =============================================================================
//  ArticleRail.js — the desktop LEFT rail: the site's front page.
//
//  An editor-less newspaper whose editor is the chain: a LEAD story chosen by
//  breadth × freshness × a sublinear price nudge (readers dominate; a pricier
//  piece only edges an equally-read cheaper one), then MORE STORIES in pure
//  chronology, then MOST READ THIS WEEK — a ranked list by recent (7-day) unlock
//  volume, where an old or even legacy article being unlocked a lot right now
//  resurfaces regardless of age. The feed is social time; this rail is editorial
//  time.
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
import { WIDE_RAIL_MIN } from '@/components/feed/feedTheme'
import { articleRouteFor } from '@/lib/searchResults'

const REFRESH_MS = 5 * 60_000 // publishes are rare; the ticker announces them live

const fmtPrice = (p) =>
  p != null && p > 0 ? `${Number(p).toLocaleString()} XEC` : 'free'

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

// Meta content: byline · price · 🔓 unlocks · 💬 comments. Unlocks are verified
// on-chain reads (circulation, not views); comments exclude deleted. Shared by
// the lead hero and the More-stories rows (each wraps it in its own class).
function MetaInner({ story }) {
  return (
    <>
      {story.author}
      {' · '}
      <span className="np-price">{fmtPrice(story.priceXec)}</span>
      {' · '}
      <span className="np-stat" title="unlocks">🔓 {Number(story.readers).toLocaleString()}</span>
      {' · '}
      <span className="np-stat" title="comments">💬 {Number(story.comments).toLocaleString()}</span>
    </>
  )
}

function Meta({ story }) {
  return (
    <div className="np-meta">
      <MetaInner story={story} />
    </div>
  )
}

// The lead: a full newspaper hero — big serif headline, a meta line
// (byline · price · readers) directly beneath it, then a generous teaser.
// The headline AND the teaser open the story (in the center pane on the home
// page, else its own page); there are no buttons — the unlock flow lives in the
// story itself, so a reader opens it and scrolls down to unlock.
function Lead({ story, now, onOpen }) {
  const href = articleRouteFor(story.slug, story.legacy)
  // Legacy posts render only on their own root page — never intercept them into
  // the in-pane reader (its route resolves current posts only). They just navigate.
  const open = onOpen && !story.legacy ? (e) => onOpen(e, story.slug) : undefined
  return (
    <div className={`np-lead${now ? ' now' : ''}`}>
      <Link
        className="np-lead-hl"
        href={href}
        onClick={open}
        data-no-navprogress={open ? '' : undefined}
      >
        <span className="np-serif np-lead-h">
          {isFresh(story.at) ? <span className="np-dot" aria-hidden /> : null}
          {story.title}
        </span>
      </Link>
      <div className="np-lead-meta">
        <MetaInner story={story} />
      </div>
      {story.teaser ? (
        <Link
          className="np-lead-teaser-link"
          href={href}
          onClick={open}
          data-no-navprogress={open ? '' : undefined}
        >
          <p className="np-lead-teaser">{story.teaser}</p>
        </Link>
      ) : null}
    </div>
  )
}

// A "Most read this week" row: rank · serif headline · recent-unlock count. The
// count is the 7-DAY tally (readers7d), not all-time — this section is where an
// old or legacy article being unlocked a lot right now resurfaces, so it's ranked
// and labelled by recent reads, deliberately distinct from the all-time 🔓 meta
// the lead and More rows carry.
function MostReadEntry({ story, rank, now, onOpen }) {
  const reads = Number(story.readers7d) || 0
  const href = articleRouteFor(story.slug, story.legacy)
  const open = onOpen && !story.legacy ? (e) => onOpen(e, story.slug) : undefined
  return (
    <Link
      className={`np-rank${now ? ' now' : ''}`}
      href={href}
      onClick={open}
      data-no-navprogress={open ? '' : undefined}
    >
      <span className="np-rank-n">{rank}</span>
      <span className="np-serif np-rank-h">{story.title}</span>
      <span className="np-rank-c" title="unlocks in the last 7 days">
        {reads.toLocaleString()} {reads === 1 ? 'read' : 'reads'}
      </span>
    </Link>
  )
}

// A More-stories row: headline + meta; the whole row opens the story on click.
function Entry({ story, now, onOpen }) {
  const href = articleRouteFor(story.slug, story.legacy)
  const open = onOpen && !story.legacy ? (e) => onOpen(e, story.slug) : undefined
  return (
    <Link
      className={`np-entry${now ? ' now' : ''}`}
      href={href}
      onClick={open}
      data-no-navprogress={open ? '' : undefined}
    >
      <span className="np-serif np-entry-h">
        {isFresh(story.at) ? <span className="np-dot" aria-hidden /> : null}
        {story.title}
      </span>
      <Meta story={story} />
    </Link>
  )
}

export default function ArticleRail({ minWidth = WIDE_RAIL_MIN, currentSlug = null, onOpenStory = null }) {
  const [data, setData] = useState(null)
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

  const lead = data?.lead ?? null
  const more = data?.more ?? []
  const mostRead = data?.mostRead ?? []

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
          {lead ? (
            <>
              <div className="np-sec">Lead story</div>
              <Lead story={lead} now={isNow(lead)} onOpen={interceptOpen} />
            </>
          ) : null}

          {mostRead.length > 0 ? (
            <>
              <div className="np-sec">Most read this week</div>
              {mostRead.map((s, i) => (
                <MostReadEntry
                  key={s.id}
                  story={s}
                  rank={i + 1}
                  now={isNow(s)}
                  onOpen={interceptOpen}
                />
              ))}
            </>
          ) : null}

          {more.length > 0 ? (
            <>
              <div className="np-sec">More stories</div>
              {more.map((s) => (
                <Entry key={s.id} story={s} now={isNow(s)} onOpen={interceptOpen} />
              ))}
            </>
          ) : null}
        </>
      )}

      <div className="np-foot">
        Write your story. <Link href="/dashboard">Publish for 1,000 XEC</Link>.
      </div>
    </div>
  )
}
