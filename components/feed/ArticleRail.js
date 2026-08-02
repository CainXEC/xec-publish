'use client'
// =============================================================================
//  ArticleRail.js — the desktop LEFT rail: the site's front page.
//
//  An editor-less newspaper whose editor is the chain: MOST READ THIS WEEK leads,
//  ranked by recent (7-day) unlock volume — the #1 story is the hero (numbered 1),
//  ranks 2..7 below it — so an old or even legacy article being unlocked a lot
//  right now leads the front page regardless of age. Then MORE STORIES in pure
//  chronology. (A week with zero unlocks falls back to a single breadth × freshness
//  hero so the page is never blank.) The feed is social time; this rail is
//  editorial time.
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
import { getAllArticleIntents, ARTICLE_INTENTS_EVENT } from '@/lib/translateStore'
import { prefetchReader } from '@/lib/readerPrefetch'

// Warm the reading pane's payload on hover/press so a click opens it instantly
// instead of showing "Turning the page…". Cheap + deduped in prefetchReader.
const warm = (slug) => ({
  onPointerEnter: () => prefetchReader(slug),
  onPointerDown: () => prefetchReader(slug),
})

const REFRESH_MS = 5 * 60_000 // publishes are rare; the ticker announces them live

const fmtPrice = (p) =>
  p != null && p > 0 ? `${Number(p).toLocaleString()} XEC` : 'free'

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

// Meta content for the More-stories rows: just byline · price. Unlock and comment
// counts were removed here to declutter — reads live in the "Most read this week"
// section above, where the count is the whole point.
function MetaInner({ story }) {
  return (
    <>
      <span className="np-author">{story.author}</span>
      <span className="np-price">{fmtPrice(story.priceXec)}</span>
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

// The lead: the #1 most-read as a hero — rank · big serif headline · its 7-day
// read count to the RIGHT (matching the ranked rows below), then a preview. The
// headline AND the teaser open the story (center pane on the home page, else its
// own page); no buttons — the unlock flow lives in the story itself. (A fallback
// hero, rendered with no rank on a zero-unlock week, shows no read count.)
function Lead({ story, rank = null, now, onOpen }) {
  // Home-page clicks open in the center pane (the reader route resolves legacy
  // and current posts alike); href stays the story's real permalink — legacy at
  // /<slug>, current at /posts/<slug> — so cmd-click and no-JS still navigate right.
  const href = articleRouteFor(story.slug, story.legacy)
  const open = onOpen ? (e) => onOpen(e, story.slug) : undefined
  const reads = Number(story.readers7d) || 0
  return (
    <div className={`np-lead${now ? ' now' : ''}`}>
      <Link
        className="np-lead-hl"
        href={href}
        onClick={open}
        {...(open ? warm(story.slug) : {})}
        data-no-navprogress={open ? '' : undefined}
      >
        {/* Matches a most-read rank row (number · headline · reads); the only
            thing that sets the #1 apart is the teaser preview below. No fresh-dot. */}
        <span className="np-lead-hrow">
          {rank != null ? <span className="np-lead-n">{rank}</span> : null}
          <span className="np-serif np-lead-h">{story.title}</span>
          {rank != null ? (
            <span className="np-lead-c" title="unlocks in the last 7 days">
              {reads.toLocaleString()} {reads === 1 ? 'read' : 'reads'}
            </span>
          ) : null}
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

// A "Most read this week" row: rank · serif headline · recent-unlock count. The
// count is the 7-DAY tally (readers7d), not all-time — this section is where an
// old or legacy article being unlocked a lot right now resurfaces, so it's ranked
// and labelled by recent reads, deliberately distinct from the all-time 🔓 meta
// the lead and More rows carry.
function MostReadEntry({ story, rank, now, onOpen }) {
  const reads = Number(story.readers7d) || 0
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
  const open = onOpen ? (e) => onOpen(e, story.slug) : undefined
  return (
    <Link
      className={`np-entry${now ? ' now' : ''}`}
      href={href}
      onClick={open}
      {...(open ? warm(story.slug) : {})}
      data-no-navprogress={open ? '' : undefined}
    >
      <span className="np-serif np-entry-h">{story.title}</span>
      <Meta story={story} />
    </Link>
  )
}

export default function ArticleRail({
  minWidth = WIDE_RAIL_MIN,
  currentSlug = null,
  onOpenStory = null,
  // 'rail' = the wide-desktop LEFT column (≥ minWidth). 'top' = the compact,
  // collapsible reflow that fills the gap BELOW the rail but ABOVE the mobile
  // bottom bar — the 1100–1279 band where there's neither the left rail (≥1280)
  // nor the bottom nav's "Paper" tab (<1100), so the front page would otherwise
  // vanish. Below 1100 the Paper tab already carries it, so the reflow stops
  // there rather than stacking on phones.
  variant = 'rail',
}) {
  const [data, setData] = useState(null)
  // The front page only fetches where it can actually show — the rail above its
  // breakpoint, the compact reflow in the gap band below it.
  const [active, setActive] = useState(false)

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

  // An article you've translated stays translated for you here too: show its
  // stored translated title in the rail (front page and article-page rail
  // alike). Read on mount and kept live — translating/reverting on the article
  // page fires ARTICLE_INTENTS_EVENT (same tab); other tabs ride `storage`.
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

  const lead = withTitle(data?.lead ?? null)
  const more = (data?.more ?? []).map(withTitle)
  const mostRead = (data?.mostRead ?? []).map(withTitle)

  // Compact reflow (below the rail breakpoint): masthead + lead + the top few
  // "most read" always visible, then the rest of the stories behind a native
  // <details> expander. Stories navigate to their page (no in-pane intercept),
  // which works at every width down to phones. Same data, same sub-components.
  if (variant === 'top') {
    const hasAny = lead || more.length > 0 || mostRead.length > 0
    return (
      <div className="npaper npaper-top">
        <div className="np-mast">The front page</div>

        {data === null ? (
          <p className="np-empty">Setting the type…</p>
        ) : !hasAny ? (
          <p className="np-empty">The presses are warm and the front page is blank.</p>
        ) : (
          <>
            {/* Compact: the #1 most-read leads (numbered 1), a few ranked below,
                the rest in the More-stories expander. Fallback hero unlabelled. */}
            {mostRead.length > 0 ? (
              <>
                <div className="np-sec">Most read this week</div>
                <Lead story={mostRead[0]} rank={1} now={isNow(mostRead[0])} onOpen={null} />
                {mostRead.slice(1, 4).map((s, i) => (
                  <MostReadEntry key={s.id} story={s} rank={i + 2} now={isNow(s)} onOpen={null} />
                ))}
              </>
            ) : lead ? (
              <Lead story={lead} now={isNow(lead)} onOpen={null} />
            ) : null}

            {more.length > 0 ? (
              <details className="np-more">
                <summary className="np-sec np-more-sum">
                  More stories <span className="np-more-n">({more.length})</span>
                </summary>
                <div className="np-more-body">
                  {more.map((s) => (
                    <Entry key={s.id} story={s} now={isNow(s)} onOpen={null} />
                  ))}
                </div>
              </details>
            ) : null}
          </>
        )}

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

      {data === null ? (
        <p className="np-empty">Setting the type…</p>
      ) : !lead && mostRead.length === 0 && more.length === 0 ? (
        <p className="np-empty">The presses are warm and the front page is blank.</p>
      ) : (
        <>
          {/* The headline section: the week's #1 most-read leads as the hero
              (numbered 1), then ranks 2..N below it. On a week with no unlocks
              at all, `lead` is the unlabelled fallback hero (no number). */}
          {mostRead.length > 0 ? (
            <>
              <div className="np-sec">Most read this week</div>
              <Lead story={mostRead[0]} rank={1} now={isNow(mostRead[0])} onOpen={interceptOpen} />
              {mostRead.slice(1).map((s, i) => (
                <MostReadEntry
                  key={s.id}
                  story={s}
                  rank={i + 2}
                  now={isNow(s)}
                  onOpen={interceptOpen}
                />
              ))}
            </>
          ) : lead ? (
            <Lead story={lead} now={isNow(lead)} onOpen={interceptOpen} />
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
        <Link href="/dashboard">Write and Publish for 1,000 XEC</Link>
      </div>
    </div>
  )
}
