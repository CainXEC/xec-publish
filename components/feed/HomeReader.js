'use client'
// =============================================================================
//  HomeReader.js — the home page's reading pane.
//
//  When a front-page headline is clicked, the story appears HERE, in the
//  feed's center column, instead of navigating away: the feed stays mounted
//  (state, tabs, scroll all preserved). The pane is pure client state — the
//  "Open full page ↗" link is the story's shareable URL. Ways back to the
//  feed: the "← The feed" bar, the PROOFOFWRITING banner, or Esc.
//
//  Content comes from /api/posts/reader/[slug], which runs the SAME
//  server-side preparation as the article page (per-viewer entitlement,
//  paywall split server-side) — locked text never reaches this pane. For a
//  locked story the pane shows the public preview; the unlock itself hops to
//  the story's own page, where the full payment flow lives (until that flow
//  is extracted into a reusable component).
//
//  Article typography rides in a neutralized .pow-article scope host, the
//  same trick the topbar uses for its .pow-feed scope.
// =============================================================================

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import PaneUnlock from '@/components/feed/PaneUnlock'
import { ARTICLE_CSS } from '@/app/posts/[slug]/articleTheme'

const fmtDate = (iso) => {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  } catch {
    return ''
  }
}

export default function HomeReader({ slug, onClose }) {
  const [state, setState] = useState({ loading: true })

  // Reusable so an in-pane unlock can refetch: the server, now seeing the
  // entitlement, returns the FULL story and the paywall block melts away.
  const load = useCallback(
    async ({ quiet = false } = {}) => {
      if (!quiet) setState({ loading: true })
      try {
        const res = await fetch(`/api/posts/reader/${encodeURIComponent(slug)}`, {
          cache: 'no-store',
        })
        const j = await res.json()
        setState(j.ok ? { loading: false, data: j } : { loading: false, error: j.error || 'Story unavailable.' })
      } catch {
        setState((cur) => (cur.data ? cur : { loading: false, error: 'Story unavailable — try again.' }))
      }
    },
    [slug],
  )

  useEffect(() => {
    void load()
  }, [load])

  // Esc turns back to the feed.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const d = state.data

  return (
    <div className="homereader">
      <div className="hr-bar">
        <button type="button" className="hr-back" onClick={onClose}>← The feed</button>
        <Link className="hr-open" href={`/posts/${slug}`}>Open full page ↗</Link>
      </div>

      {state.loading ? (
        <p className="hr-state">Turning the page…</p>
      ) : state.error ? (
        <p className="hr-state">{state.error}</p>
      ) : (
        <div className="pow-article readerhost">
          <style>{ARTICLE_CSS}</style>
          <h1 className="np-serif hr-title">{d.title}</h1>
          <p className="hr-meta">
            {d.author?.name ? (
              <>
                by{' '}
                <span
                  className="hr-author"
                  style={d.author.color ? { color: d.author.color } : undefined}
                >
                  {d.author.handle ? `@${d.author.handle}` : d.author.name}
                </span>
                {' · '}
              </>
            ) : null}
            {d.readMinutes ? `${d.readMinutes} min · ` : ''}
            {d.publishedAt ? fmtDate(d.publishedAt) : ''}
          </p>

          {/* Server-prepared HTML: public part only unless this viewer is
              entitled — the same bytes the article page would render. */}
          <div className="prose" dangerouslySetInnerHTML={{ __html: d.bodyHtml }} />

          {d.hasPaywall && !d.unlocked ? (
            <PaneUnlock
              postId={d.postId}
              priceXec={d.priceXec}
              authorAddress={d.author?.xecAddress}
              slug={slug}
              onUnlocked={() => load({ quiet: true })}
            />
          ) : null}
        </div>
      )}
    </div>
  )
}
