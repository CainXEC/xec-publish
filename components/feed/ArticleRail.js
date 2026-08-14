'use client'
// =============================================================================
//  ArticleRail.js — the front page rail (desktop left column, the mobile Paper
//  tab, and the narrow-desktop reflow).
//
//  ONE filtered list of the top 25 stories. A dropdown picks the lens:
//    Most read · 24h / 7d / all time  → ranked by verified on-chain unlock
//        volume over that window; an old/legacy piece unlocked a lot right now
//        resurfaces regardless of age. #1 is the hero.
//    Latest                           → newest published first, plain
//        chronology, no read filter.
//  The feed is social time; this rail is editorial time. Newspaper-ness comes from
//  STRUCTURE (masthead, dateline folio, a hero lead, hairline entries) — serif
//  headlines (serif = writing, mono = machinery, neon = money).
//
//  Interactions: a headline opens the story; on the home page it opens a center
//  reading pane, elsewhere it navigates. Fresh stories (<24h being read) get the
//  live dot. With no stories the rail becomes a house ad.
// =============================================================================

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { WIDE_RAIL_MIN } from '@/components/feed/feedTheme'
import { articleRouteFor } from '@/lib/searchResults'
import { getAllArticleIntents, ARTICLE_INTENTS_EVENT } from '@/lib/translateStore'
import { prefetchReader } from '@/lib/readerPrefetch'

// Warm the reading pane's payload on hover/press so a click opens it instantly
// instead of showing "Turning the page…". Cheap + deduped in prefetchReader.
const warm = (slug) => ({
  onPointerEnter: () => prefetchReader(slug),
  onPointerDown: () => prefetchReader(slug),
})

const REFRESH_MS = 5 * 60_000 // publishes are rare; the ticker announces them live

// The filter lenses. `title` is the read-count tooltip; Latest shows no count.
const RANGES = [
  { key: '24h', label: 'Most read · 24h', title: 'unlocks in the last 24 hours' },
  { key: '7d', label: 'Most read · 7d', title: 'unlocks in the last 7 days' },
  { key: 'all', label: 'Most read · all time', title: 'unlocks all-time' },
  { key: 'latest', label: 'Latest', title: null },
]
// Opens on the newest article, not a most-read ranking — a fresh visitor's
// first view of the front page is what just got published, not what's popular.
const DEFAULT_RANGE = 'latest'
const RANGE_BY_KEY = Object.fromEntries(RANGES.map((r) => [r.key, r]))
// Non-compact rendering shows the hero + this many ranked rows (10 total)
// before "Load more" reveals the rest of the already-fetched list.
const INITIAL_REST_N = 9

// Live masthead dateline: the date plus a ticking clock (with seconds). Its own
// component so only this line re-renders each second, not the whole rail.
function FrontPageClock() {
  const [now, setNow] = useState(null)

  useEffect(() => {
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

// The #1 story as a hero: rank · big serif headline (byline inline at the end,
// wrapping with it) · its read count to the right (most-read lenses) · a
// teaser below. The byline shows in every lens now, not just Latest.
//
// The number and count are FLOATED, not flex siblings — a flex layout only
// ever occupies its own single line, so once the headline wraps (now that it
// carries the byline too) the number's own column sits empty for every line
// after the first, reading as blank space next to the rest of the row. A
// float lets the first line indent around it as usual, but once the wrapped
// text (and the teaser below) passes the float's bottom edge, it goes back to
// the FULL row width — text fills the space instead of leaving it blank
// beside a lone number. .np-lead needs overflow:hidden to contain the floats
// (else they'd bleed past the row's own bottom border).
function Lead({ story, rank, now, onOpen, showCount, countTitle }) {
  const href = articleRouteFor(story.slug, story.legacy)
  const open = onOpen ? (e) => onOpen(e, story.slug) : undefined
  const reads = Number(story.count) || 0
  return (
    <div className={`np-lead${now ? ' now' : ''}`}>
      <Link
        className="np-lead-hl"
        href={href}
        onClick={open}
        {...(open ? warm(story.slug) : {})}
        data-no-navprogress={open ? '' : undefined}
      >
        <span className="np-lead-n">{rank}</span>
        {showCount ? (
          <span className="np-lead-c" title={countTitle || undefined}>
            {reads.toLocaleString()}
          </span>
        ) : null}
        <span className="np-serif np-lead-h">
          {story.title}
          <span className="np-lead-by"> {story.author}</span>
        </span>
      </Link>
      {story.teaser ? (
        <Link
          className="np-lead-teaser-link"
          href={href}
          onClick={open}
          {...(open ? warm(story.slug) : {})}
          data-no-navprogress={open ? '' : undefined}
        >
          <p className="np-lead-teaser">{story.teaser}</p>
        </Link>
      ) : null}
    </div>
  )
}

// A ranked row: rank · serif headline (byline inline at the end, wrapping
// with it) · read count (most-read lenses) · a teaser below, same treatment
// as the hero for every article, not just #1. Same float-based layout as
// Lead, same reason (see its comment) — .np-rank needs overflow:hidden to
// contain the floated number/count.
function StoryRow({ story, rank, now, onOpen, showCount, countTitle }) {
  const reads = Number(story.count) || 0
  const href = articleRouteFor(story.slug, story.legacy)
  const open = onOpen ? (e) => onOpen(e, story.slug) : undefined
  return (
    <Link
      className={`np-rank${now ? ' now' : ''}`}
      href={href}
      onClick={open}
      {...(open ? warm(story.slug) : {})}
      data-no-navprogress={open ? '' : undefined}
    >
      <span className="np-rank-n">{rank}</span>
      {showCount ? (
        <span className="np-rank-c" title={countTitle || undefined}>
          {reads.toLocaleString()}
        </span>
      ) : null}
      <span className="np-rank-body">
        <span className="np-serif np-rank-h">
          {story.title}
          <span className="np-rank-by"> {story.author}</span>
        </span>
        {story.teaser ? <span className="np-rank-teaser">{story.teaser}</span> : null}
      </span>
    </Link>
  )
}

export default function ArticleRail({
  minWidth = WIDE_RAIL_MIN,
  currentSlug = null,
  onOpenStory = null,
  // 'rail' = the wide-desktop LEFT column (≥ minWidth); also the mobile Paper tab
  // (rendered with minWidth=0 so it's always active + full width). 'top' = the
  // compact reflow in the 1100–1279 band with neither the left rail nor the mobile
  // Paper tab, so the front page would otherwise vanish there.
  variant = 'rail',
}) {
  const [data, setData] = useState(null)
  const [range, setRange] = useState(DEFAULT_RANGE)
  // The front page only fetches where it can actually show — the rail above its
  // breakpoint, the compact reflow in the gap band below it.
  const [active, setActive] = useState(false)
  // Non-compact rendering (the wide rail, the mobile Paper tab — NOT the narrow
  // 'top' reflow, which keeps its own 5-row/<details> truncation) starts at the
  // top 10 (the hero + 9 ranked rows) and reveals the rest of the already-
  // fetched list on click — no extra fetch, since the API already returns up
  // to 25. Reset whenever the lens changes so switching filters doesn't carry
  // over a stale expansion.
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    const query =
      variant === 'top'
        ? `(min-width: 1100px) and (max-width: ${minWidth - 1}px)`
        : `(min-width: ${minWidth}px)`
    const mq = window.matchMedia(query)
    const update = () => setActive(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [minWidth, variant])

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
        const res = await fetch(`/api/articles/rail?range=${range}`, { cache: 'no-store' })
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
  }, [active, range])

  // An article you've translated stays translated for you here too: show its
  // stored translated title in the rail. Read on mount and kept live.
  const [titleOverrides, setTitleOverrides] = useState({})
  useEffect(() => {
    const sync = () => setTitleOverrides(getAllArticleIntents())
    sync()
    window.addEventListener(ARTICLE_INTENTS_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(ARTICLE_INTENTS_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])
  const withTitle = (s) => {
    const t = s && titleOverrides[s.slug]?.title
    return t ? { ...s, title: t } : s
  }

  const stories = (data?.stories ?? []).map(withTitle)
  const showCount = range !== 'latest'
  const countTitle = RANGE_BY_KEY[range]?.title ?? null

  const onRangeChange = (e) => {
    setRange(e.target.value)
    setData(null) // show the skeleton instantly while the new lens loads
    setExpanded(false) // a fresh lens starts back at the top 10, not mid-scroll
  }

  const Filter = (
    <select className="np-filter" value={range} onChange={onRangeChange} aria-label="Front page filter">
      {RANGES.map((r) => (
        <option key={r.key} value={r.key}>
          {r.label}
        </option>
      ))}
    </select>
  )

  // The list: hero (#1) + ranked rows. `compact` (the narrow reflow) shows a few
  // rows then tucks the rest behind a native <details> so it doesn't run long
  // above the feed. Non-compact (the wide rail, the mobile Paper tab) starts at
  // the top 10 and reveals the rest via a "Load more" button on click — same
  // goal (don't dump 25 rows on screen at once), a real button instead of a
  // disclosure since this list can run much longer than the compact reflow's.
  const renderList = (onOpen, { compact = false } = {}) => {
    const head = stories[0]
    const rest = stories.slice(1)
    const visibleRest = compact
      ? rest.slice(0, 5)
      : expanded
        ? rest
        : rest.slice(0, INITIAL_REST_N)
    const hiddenRest = compact ? rest.slice(5) : []
    const moreToLoad = !compact && !expanded ? rest.length - visibleRest.length : 0
    return (
      <>
        <Lead
          story={head}
          rank={1}
          now={isNow(head)}
          onOpen={onOpen}
          showCount={showCount}
          countTitle={countTitle}
        />
        {visibleRest.map((s, i) => (
          <StoryRow
            key={s.id}
            story={s}
            rank={i + 2}
            now={isNow(s)}
            onOpen={onOpen}
            showCount={showCount}
            countTitle={countTitle}
          />
        ))}
        {hiddenRest.length > 0 ? (
          <details className="np-more">
            <summary className="np-sec np-more-sum">
              Show all {stories.length} <span className="np-more-n">(+{hiddenRest.length})</span>
            </summary>
            <div className="np-more-body">
              {hiddenRest.map((s, i) => (
                <StoryRow
                  key={s.id}
                  story={s}
                  rank={i + 2 + visibleRest.length}
                  now={isNow(s)}
                  onOpen={onOpen}
                  showCount={showCount}
                  countTitle={countTitle}
                />
              ))}
            </div>
          </details>
        ) : null}
        {moreToLoad > 0 ? (
          <button
            type="button"
            className="np-loadmore"
            onClick={() => setExpanded(true)}
          >
            Load more <span className="np-more-n">(+{moreToLoad})</span>
          </button>
        ) : null}
      </>
    )
  }

  const emptyNote = range === 'latest'
    ? 'No stories yet.'
    : 'Nothing unlocked in this window yet — try “all time” or “Latest”.'

  const body =
    data === null ? (
      <p className="np-empty">Setting the type…</p>
    ) : stories.length === 0 ? (
      <p className="np-empty">{emptyNote}</p>
    ) : (
      renderList(variant === 'top' ? null : interceptOpen, { compact: variant === 'top' })
    )

  if (variant === 'top') {
    return (
      <div className="npaper npaper-top">
        <div className="np-mast">The front page</div>
        <div className="np-filterbar">{Filter}</div>
        {body}
        <div className="np-foot">
          <Link href="/dashboard">Write and Publish for 1,000 XEC</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="npaper">
      <div className="np-mast">The front page</div>
      <FrontPageClock />
      <div className="np-filterbar">{Filter}</div>
      {body}
      <div className="np-foot">
        <Link href="/dashboard">Write and Publish for 1,000 XEC</Link>
      </div>
    </div>
  )
}
