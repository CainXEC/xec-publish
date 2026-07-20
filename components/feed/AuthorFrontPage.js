'use client'
// =============================================================================
//  AuthorFrontPage.js — the LEFT rail of an author profile: their own paper.
//
//  Same newspaper structure as the site's front page (ArticleRail), scoped to
//  one byline: masthead, a dateline folio of their public stats (stories,
//  readers, writing since — READERS are shown publicly, earned XEC stays on
//  the author's own dashboard), MOST READ by verified unlocks, LATEST in
//  chronology, with the peek-in-place interaction. Headlines navigate to the
//  story's page, which keeps its own newspaper spread on desktop.
//
//  No fetching: everything renders from the hydrated articles the profile
//  page already loads (per-story unlock counts included), so this rail is
//  free — hidden below 1280px purely by CSS.
// =============================================================================

import { useState } from 'react'
import Link from 'next/link'

const MOST_READ_N = 3
const LATEST_N = 5

const fmtPrice = (p) => (p != null && p > 0 ? `${Number(p).toLocaleString()} XEC` : 'free')

const storyAt = (p) => p.published_at ?? p.created_at

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

const readersOf = (p) => {
  const u = Array.isArray(p.unlocks) ? p.unlocks[0] : p.unlocks
  const n = typeof u?.count === 'number' ? u.count : Number(u?.count)
  return Number.isFinite(n) ? n : 0
}

const hrefOf = (p) =>
  p.legacy ? `/${encodeURIComponent(p.slug)}` : `/posts/${encodeURIComponent(p.slug)}`

function Meta({ story }) {
  const readers = readersOf(story)
  return (
    <div className="np-meta">
      <span className="np-price">{fmtPrice(story.price_xec)}</span>
      {' · '}
      {readers > 0 ? `${readers} reader${readers === 1 ? '' : 's'}` : timeAgo(storyAt(story))}
    </div>
  )
}

function Entry({ story, open, onToggle, onOpen }) {
  return (
    <div
      className={`np-entry${open ? ' open' : ''}`}
      onClick={(e) => {
        if (e.target.closest('a')) return
        onToggle()
      }}
    >
      <Link
        className="np-hl"
        href={hrefOf(story)}
        onClick={onOpen ? (e) => onOpen(e, story) : undefined}
        data-no-navprogress={onOpen && !story.legacy ? true : undefined}
      >
        <span className="np-serif np-entry-h">{story.title}</span>
      </Link>
      {open ? (
        <>
          {story.teaser ? <p className="np-teaser">{story.teaser}</p> : null}
          <div className="np-btns">
            <Link
              className="np-btn"
              href={hrefOf(story)}
              onClick={onOpen ? (e) => onOpen(e, story) : undefined}
              data-no-navprogress={onOpen && !story.legacy ? true : undefined}
            >
              Read →
            </Link>
            {story.price_xec > 0 ? (
              // Unlock always goes to the story's page (the pane hosts its
              // own unlock too, but the button promises the full flow).
              <Link className="np-btn unlock" href={hrefOf(story)}>
                Unlock · {Number(story.price_xec).toLocaleString()} XEC
              </Link>
            ) : null}
          </div>
        </>
      ) : (
        <Meta story={story} />
      )}
    </div>
  )
}

export default function AuthorFrontPage({ identity, stories = [], onOpenStory = null }) {
  const [openId, setOpenId] = useState(null)
  const toggle = (id) => setOpenId((cur) => (cur === id ? null : id))

  // Host page provides a reading pane: intercept plain clicks and open the
  // story in place. Legacy imports live on a different route/renderer, and
  // modifier clicks (new tab etc.) always fall through to real navigation.
  const interceptOpen = onOpenStory
    ? (e, story) => {
        if (story.legacy) return
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1) return
        e.preventDefault()
        onOpenStory(story.slug)
      }
    : null

  const usable = stories.filter((p) => p?.slug && p?.title)
  if (usable.length === 0) return null

  const totalReaders = usable.reduce((sum, p) => sum + readersOf(p), 0)
  const earliest = usable.reduce((min, p) => {
    const t = Date.parse(storyAt(p))
    return Number.isFinite(t) && t < min ? t : min
  }, Infinity)
  const since = Number.isFinite(earliest) && earliest !== Infinity
    ? new Date(earliest).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
    : null

  const mostRead = usable
    .filter((p) => readersOf(p) > 0)
    .sort((a, b) => readersOf(b) - readersOf(a))
    .slice(0, MOST_READ_N)
  const shown = new Set(mostRead.map((p) => p.id))
  const latest = usable.filter((p) => !shown.has(p.id)).slice(0, LATEST_N)

  const isHandle = String(identity ?? '').startsWith('@')

  return (
    <div className="npaper">
      <div className="np-mast">{isHandle ? `${identity}'s pages` : "The author's pages"}</div>
      <div className="np-date">
        {usable.length.toLocaleString()} {usable.length === 1 ? 'story' : 'stories'}
        {totalReaders > 0 ? ` · ${totalReaders.toLocaleString()} readers` : ''}
        {since ? ` · writing since ${since}` : ''}
      </div>

      {mostRead.length > 0 ? (
        <>
          <div className="np-sec np-first">Most read</div>
          <div className="np-ranks">
            {mostRead.map((p, i) => (
              <Link
                className="np-rank"
                key={p.id}
                href={hrefOf(p)}
                onClick={interceptOpen ? (e) => interceptOpen(e, p) : undefined}
                data-no-navprogress={interceptOpen && !p.legacy ? true : undefined}
              >
                <span className="np-rank-n">{i + 1}</span>
                <span className="np-serif np-rank-h">{p.title}</span>
                <span className="np-rank-c">{readersOf(p)}</span>
              </Link>
            ))}
          </div>
        </>
      ) : null}

      {latest.length > 0 ? (
        <>
          <div className={`np-sec${mostRead.length === 0 ? ' np-first' : ''}`}>Latest</div>
          {latest.map((p) => (
            <Entry
              key={p.id}
              story={p}
              open={openId === p.id}
              onToggle={() => toggle(p.id)}
              onOpen={interceptOpen}
            />
          ))}
        </>
      ) : null}
    </div>
  )
}
