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
import CopyLinkButton from '@/components/feed/CopyLinkButton'
import TranslateButton from '@/components/TranslateButton'
import ArticleComments from '@/components/ArticleComments'
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

export default function HomeReader({ slug, onClose, backLabel = '← The feed' }) {
  const [state, setState] = useState({ loading: true })
  // Translated view ({ translated: html, title }); null = original. The parent
  // keys this component by slug, so it remounts per story — tr resets naturally.
  const [tr, setTr] = useState(null)
  // Viewer session — needed so the comments section can show the Delete button
  // (own comments) and let an author moderate. The article page passes the same
  // `me` to ArticleComments; the pane was missing it, so delete never appeared.
  const [me, setMe] = useState(null)

  useEffect(() => {
    let alive = true
    fetch('/api/me', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (alive) setMe(data?.authenticated ? data : null)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

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

  // The pane never touches the address bar, so — like CopyLinkButton — the share
  // targets are built from the slug, not window.location (which is the feed's URL
  // here). Title comes from the loaded story. Mirrors the standalone article
  // page's share handlers (PostPageClient handleShareX / handleSharePow). A legacy
  // story's permalink is root /<slug>, not /posts/<slug>, so honor the flag the
  // reader route returns (falls back to /posts/<slug> until the body loads).
  const articlePath = d?.legacy
    ? `/${encodeURIComponent(slug)}`
    : `/posts/${encodeURIComponent(slug)}`
  const articleUrl = () => `${window.location.origin}${articlePath}`
  const shareToX = () => {
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
      tr?.title ?? d?.title ?? '',
    )}&url=${encodeURIComponent(articleUrl())}`
    window.open(url, '_blank', 'noopener,noreferrer')
  }
  const shareToFeed = () => {
    const text = `${tr?.title ?? d?.title ?? ''}\n\n${articleUrl()}`.trim()
    window.location.href = `/?share=${encodeURIComponent(text)}`
  }

  return (
    <div className="homereader">
      <div className="hr-bar">
        <button type="button" className="hr-back" onClick={onClose}>{backLabel}</button>
        <div className="hr-actions">
          {d && !state.loading ? (
            <>
              <TranslateButton
                kind="article"
                id={slug}
                onTranslated={setTr}
                onShowOriginal={() => setTr(null)}
              />
              <button type="button" className="hr-open" onClick={shareToFeed}>
                Share to feed
              </button>
              <button type="button" className="hr-open" onClick={shareToX}>
                Post to 𝕏
              </button>
            </>
          ) : null}
          <CopyLinkButton path={articlePath} />
        </div>
      </div>

      {state.loading ? (
        <p className="hr-state">Turning the page…</p>
      ) : state.error ? (
        <p className="hr-state">{state.error}</p>
      ) : (
        <div className="pow-article readerhost">
          <style>{ARTICLE_CSS}</style>
          <h1 className="np-serif hr-title">{tr?.title ?? d.title}</h1>
          <p className="hr-meta">
            {d.author?.name ? (
              <>
                by{' '}
                {d.author.handle || d.author.username || d.author.xecAddress ? (
                  // Same routing as the article page's byline: the live
                  // handle when one is held, else the legacy username path,
                  // else the wallet address (/@identifier resolves both
                  // handles and bare addresses).
                  <Link
                    className="hr-author"
                    href={
                      d.author.handle
                        ? `/@${encodeURIComponent(d.author.handle)}`
                        : d.author.username
                          ? `/u/${encodeURIComponent(d.author.username)}`
                          : `/@${encodeURIComponent(
                              d.author.xecAddress.toLowerCase().replace(/^ecash:/, ''),
                            )}`
                    }
                    style={d.author.color ? { '--hc': d.author.color } : undefined}
                  >
                    {d.author.handle ? `@${d.author.handle}` : d.author.name}
                  </Link>
                ) : (
                  <span
                    className="hr-author"
                    style={d.author.color ? { '--hc': d.author.color } : undefined}
                  >
                    {d.author.name}
                  </span>
                )}
                {d.author.isAi ? (
                  <>
                    {' '}
                    <span className="aibadge" title="AI-operated account">
                      [AI]
                    </span>
                  </>
                ) : null}
                {' · '}
              </>
            ) : null}
            {d.readMinutes ? `${d.readMinutes} min · ` : ''}
            {d.publishedAt ? fmtDate(d.publishedAt) : ''}
            {` · ${d.priceXec > 0 ? `${Number(d.priceXec).toLocaleString()} XEC` : 'Free'}`}
            {` · ${Number(d.unlockCount ?? 0)} unlock${d.unlockCount === 1 ? '' : 's'}`}
            {' · '}
            {d.unlocked ? (
              // Once unlocked the comments render below in the pane — let the
              // count jump straight to them (mirrors the article page).
              <button
                type="button"
                className="hr-jump"
                onClick={() =>
                  document.getElementById('comments')?.scrollIntoView({ behavior: 'smooth' })
                }
              >
                {Number(d.commentCount ?? 0)} comment{d.commentCount === 1 ? '' : 's'}
              </button>
            ) : (
              `${Number(d.commentCount ?? 0)} comment${d.commentCount === 1 ? '' : 's'}`
            )}
          </p>

          {/* Server-prepared HTML: public part only unless this viewer is
              entitled — the same bytes the article page would render. */}
          <div className="prose" dangerouslySetInnerHTML={{ __html: tr?.translated ?? d.bodyHtml }} />

          {d.hasPaywall && !d.unlocked ? (
            <PaneUnlock
              postId={d.postId}
              priceXec={d.priceXec}
              authorAddress={d.author?.xecAddress}
              slug={slug}
              onUnlocked={(bodyHtml) => {
                // Optimistic paint: verify-payment handed back the full body, so
                // swap it in now — the paywall melts and the story opens in the
                // same tick, no refetch wait. Then reconcile counts/session-derived
                // bits quietly. (Recovery races pass no body → just reconcile.)
                if (typeof bodyHtml === 'string' && bodyHtml) {
                  setState((cur) =>
                    cur.data
                      ? { ...cur, data: { ...cur.data, bodyHtml, unlocked: true } }
                      : cur,
                  )
                }
                void load({ quiet: true })
              }}
            />
          ) : null}

          {/* Same rule as the article page: entitled readers (an unlock, or
              the author/admin — the server folds those into `unlocked`) get
              the comment section right in the pane. */}
          {d.unlocked && d.postId ? (
            <ArticleComments
              postId={d.postId}
              canComment={d.unlocked}
              me={me}
              isAuthorSession={Boolean(me?.authorId && d.authorId && me.authorId === d.authorId)}
              onChanged={() => void load({ quiet: true })}
            />
          ) : null}
        </div>
      )}
    </div>
  )
}
