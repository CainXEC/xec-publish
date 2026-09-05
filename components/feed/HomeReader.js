'use client'
// =============================================================================
//  HomeReader.js — the home page's reading pane.
//
//  When a front-page headline is clicked, the story appears HERE, in the
//  feed's center column, instead of navigating away: the feed stays mounted
//  (state, tabs, scroll all preserved). The pane is pure client state — the
//  "Open full page ↗" link is the story's shareable URL. Ways back to the
//  feed: the "← Feed" bar, the PROOFOFWRITING banner, or Esc.
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
import { takePrefetchedReader } from '@/lib/readerPrefetch'
import { setTranslation, setArticleIntent } from '@/lib/translateStore'
import { fetchTranslation } from '@/lib/translateClient'
import { ARTICLE_CSS } from '@/app/posts/[slug]/articleTheme'
import { actorLabel, timeAgo } from '@/lib/notifFormat'
import { profileHrefForIdentity } from '@/lib/contentLinks'

// Pinned locale + UTC so SSR and client hydrate identical text (#418).
const fmtDate = (iso) => {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    })
  } catch {
    return ''
  }
}

export default function HomeReader({ slug, onClose, backLabel = '← Feed' }) {
  const [state, setState] = useState({ loading: true })
  // Translated view ({ translated: html, title }); null = original. The parent
  // keys this component by slug, so it remounts per story — tr resets naturally.
  const [tr, setTr] = useState(null)
  // Drives a "Translating…" caption while the post-unlock re-translate (below)
  // is in flight — that path bypasses TranslateButton's own pending state
  // entirely (it calls fetchTranslation directly), so without this the pane
  // just silently reverted to the original language with no indication a
  // fresh translation was even coming.
  const [retranslating, setRetranslating] = useState(false)
  // Viewer session — needed so the comments section can show the Delete button
  // (own comments) and let an author moderate. The article page passes the same
  // `me` to ArticleComments; the pane was missing it, so delete never appeared.
  const [me, setMe] = useState(null)

  // Author-only: who unlocked this article. The pane is keyed by slug (remounts
  // per story), so this state resets naturally when a different article opens.
  const [unlockersOpen, setUnlockersOpen] = useState(false)
  const [unlockers, setUnlockers] = useState(null) // null = not loaded yet
  const [unlockersError, setUnlockersError] = useState(false)
  const loadUnlockers = useCallback(async (postId) => {
    if (!postId) return
    setUnlockersError(false)
    try {
      const res = await fetch(`/api/unlock-viewers/${encodeURIComponent(postId)}`, {
        cache: 'no-store',
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && Array.isArray(data?.viewers)) setUnlockers(data.viewers)
      else setUnlockersError(true)
    } catch {
      setUnlockersError(true)
    }
  }, [])
  const toggleUnlockers = useCallback(
    (postId) => {
      setUnlockersOpen((open) => {
        const next = !open
        if (next && unlockers === null && !unlockersError) void loadUnlockers(postId)
        return next
      })
    },
    [unlockers, unlockersError, loadUnlockers],
  )

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
    async ({ quiet = false, fresh = false } = {}) => {
      if (!quiet) setState({ loading: true })
      try {
        // First open: use the payload a hover/press already warmed, so the pane
        // paints without waiting on the round-trip. Reconciles (post-unlock,
        // post-comment) pass fresh:true to skip the (now stale) warmed preview.
        const warmed = fresh ? null : takePrefetchedReader(slug)
        let j = warmed ? await warmed : null
        if (!j || !j.ok) {
          const res = await fetch(`/api/posts/reader/${encodeURIComponent(slug)}`, {
            cache: 'no-store',
          })
          j = await res.json()
        }
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
  const isAuthorSession = Boolean(me?.authorId && d?.authorId && me.authorId === d.authorId)

  // The pane never touches the address bar, so — like CopyLinkButton — the share
  // targets are built from the slug, not window.location (which is the feed's URL
  // here). Title comes from the loaded story. Mirrors the standalone article
  // page's share handler (PostPageClient handleSharePow). A legacy
  // story's permalink is root /<slug>, not /posts/<slug>, so honor the flag the
  // reader route returns (falls back to /posts/<slug> until the body loads).
  const articlePath = d?.legacy
    ? `/${encodeURIComponent(slug)}`
    : `/posts/${encodeURIComponent(slug)}`
  const articleUrl = () => `${window.location.origin}${articlePath}`
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
              {/* Re-translating the full body after an unlock (see onUnlocked below) —
                  bypasses TranslateButton's own pending state, so without this the
                  pane just silently reverted to the original language. Reuses
                  TranslateButton's own .tb-loading/.tb-dots markup so it reads
                  identically to the button's normal "Translating…" caption. */}
              {retranslating ? (
                <span className="tb-loading" role="status" aria-live="polite">
                  Translating<span className="tb-dots" aria-hidden="true" />
                </span>
              ) : null}
              <button type="button" className="hr-open" onClick={shareToFeed}>
                Share to feed
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
            {' · '}
            {isAuthorSession ? (
              <button
                type="button"
                className="hr-jump unlockers-toggle"
                onClick={() => toggleUnlockers(d.postId)}
                aria-expanded={unlockersOpen}
                title="See who unlocked this article"
              >
                {Number(d.unlockCount ?? 0)} unlock{d.unlockCount === 1 ? '' : 's'}
                {unlockersOpen ? ' ▲' : ' ▼'}
              </button>
            ) : (
              `${Number(d.unlockCount ?? 0)} unlock${d.unlockCount === 1 ? '' : 's'}`
            )}
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

          {/* Author-only reveal: who unlocked this article (same author-gated
              route + list as the standalone article page). */}
          {isAuthorSession && unlockersOpen ? (
            <div className="unlockers" role="region" aria-label="Readers who unlocked this article">
              {unlockers === null && !unlockersError ? (
                <p className="unlockers-note">Loading…</p>
              ) : unlockersError ? (
                <p className="unlockers-note">Couldn’t load the list.</p>
              ) : unlockers.length === 0 ? (
                <p className="unlockers-note">No one has unlocked this yet.</p>
              ) : (
                <>
                  {/* Distinct readers — see the article page for why this can read
                      lower than the raw unlock tally. */}
                  <p className="unlockers-head">
                    {unlockers.length} reader{unlockers.length === 1 ? '' : 's'}
                  </p>
                  <ul className="unlockers-list">
                    {unlockers.map((v, i) => {
                      const isHandle = typeof v.identity === 'string' && v.identity.startsWith('@')
                      const href = profileHrefForIdentity(v.identity)
                      const whoStyle = isHandle && v.color ? { '--hc': v.color } : undefined
                      const whoInner = (
                        <>
                          {actorLabel(v.identity)}
                          {v.isAi ? <span className="unlockers-ai"> [AI]</span> : null}
                        </>
                      )
                      return (
                        <li key={`${v.identity}-${i}`} className="unlockers-row">
                          {href ? (
                            <Link href={href} className="unlockers-who" style={whoStyle}>
                              {whoInner}
                            </Link>
                          ) : (
                            <span className="unlockers-who" style={whoStyle}>
                              {whoInner}
                            </span>
                          )}
                          {v.unlockedAt ? (
                            <span className="unlockers-when">{timeAgo(v.unlockedAt)}</span>
                          ) : null}
                        </li>
                      )
                    })}
                  </ul>
                </>
              )}
            </div>
          ) : null}

          {/* Server-prepared HTML: public part only unless this viewer is
              entitled — the same bytes the article page would render. */}
          <div className="prose" dangerouslySetInnerHTML={{ __html: tr?.translated ?? d.bodyHtml }} />

          {!d.unlocked && Number(d.priceXec) > 0 ? (
            <PaneUnlock
              postId={d.postId}
              priceXec={d.priceXec}
              authorAddress={d.author?.xecAddress}
              slug={slug}
              // Show the unlock for any priced, not-yet-unlocked article — even one
              // with NO paywall marker: unlocking still grants commenting, so the
              // pane must offer it (matching the article page). commentsOnly drives
              // the copy when nothing is actually locked.
              commentsOnly={!d.hasLockedContent}
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
                // If a preview translation was showing, it covered only the public
                // bytes — re-translate the now-full body. Drop the stale short
                // translation first so the unlocked story shows immediately rather
                // than looking empty while the new translation loads.
                if (tr?.lang) {
                  const lang = tr.lang
                  setTr(null)
                  setRetranslating(true)
                  void fetchTranslation('article', slug, lang).then((d) => {
                    if (d) {
                      setTr(d)
                      setTranslation('article', slug, d)
                      setArticleIntent(slug, { lang, title: d.title })
                    }
                    setRetranslating(false)
                  })
                }
                void load({ quiet: true, fresh: true })
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
              isAuthorSession={isAuthorSession}
              onChanged={() => void load({ quiet: true, fresh: true })}
            />
          ) : null}
        </div>
      )}
    </div>
  )
}
