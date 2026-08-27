'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import ActivityRail from '@/components/feed/ActivityRail'
import ArticleRail from '@/components/feed/ArticleRail'
import ComposeBox from '@/components/feed/ComposeBox'
import FeedPost, { MintDigestRow } from '@/components/feed/FeedPost'
import ForumDirectory from '@/components/feed/ForumDirectory'
import FeedTopbar from '@/components/feed/FeedTopbar'
import HomeReader from '@/components/feed/HomeReader'
import ThreadPane from '@/components/feed/ThreadPane'
import { getSeenMap, reorderBySeen } from '@/lib/feedSeenStore'
import { FEED_CSS } from '@/components/feed/feedTheme'

export default function FeedClient({
  initialPosts = [],
  initialNextCursor = null,
  initialLoadError = null,
  viewerAccountId: initialViewerAccountId = null,
  isAuthor = false,
  initialCompose = '',
  focusCompose = false,
  initialScope = 'foryou',
}) {
  const [scope, setScope] = useState(initialScope) // 'foryou' | 'forums'

  // `?tab=forums` is a ONE-SHOT deep link (the "← Forums" back link) that opens
  // the Forums tab. Strip it from the address bar right after it's read, so the
  // URL never sticks in history/bookmarks/session-restore — otherwise the browser
  // keeps reopening the site at /?tab=forums instead of the default Feed.
  useEffect(() => {
    if (
      initialScope === 'forums' &&
      typeof window !== 'undefined' &&
      window.location.search.includes('tab=forums')
    ) {
      window.history.replaceState(null, '', window.location.pathname)
    }
    // Runs once on mount; initialScope is fixed for the page's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // The reading pane: a front-page story OR a feed thread open in the center
  // column, as pure client state — the URL stays put (no history games; the
  // App Router treats pushState as a navigation and fights the scroll
  // restore). The feed below stays MOUNTED (hidden), so tabs/posts/scroll
  // all survive the detour; each pane's "Open full page ↗" link is the
  // shareable URL.
  const [pane, setPane] = useState(null) // {kind:'article',slug} | {kind:'thread',txid} | null
  // Mobile: the top composer is hidden and replaced by a floating pen-nib button
  // that opens the composer as a bottom sheet. Desktop keeps the inline composer.
  const [composeOpen, setComposeOpen] = useState(false)
  const paneOpenRef = useRef(false)
  const feedScrollRef = useRef(0)
  // The pane is a WIDE-SHELL behavior: on phones a post click must keep
  // navigating to the thread page, where the browser back gesture works as
  // people expect. Same matchMedia gate the rails use.
  const [wideShell, setWideShell] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1100px)')
    const update = () => setWideShell(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  const openPane = useCallback((next) => {
    // Only remember the feed position on the FIRST open — swapping content
    // inside an already-open pane (thread → thread) must not clobber it.
    if (!paneOpenRef.current) feedScrollRef.current = window.scrollY
    paneOpenRef.current = true
    setPane(next)
    window.scrollTo(0, 0)
  }, [])

  const openStory = useCallback(
    (slug) => {
      if (slug) openPane({ kind: 'article', slug })
    },
    [openPane],
  )

  const openThread = useCallback(
    // `seed` is an optional optimistic post (e.g. a just-made quote) rendered in
    // the pane instantly while the real thread is fetched + reconciled.
    (txid, seed = null) => {
      const t = String(txid ?? '').trim().toLowerCase()
      if (/^[0-9a-f]{64}$/.test(t)) {
        openPane({ kind: 'thread', txid: t, seed: seed && seed.txid ? seed : null })
      }
    },
    [openPane],
  )

  const closeReader = useCallback(() => {
    paneOpenRef.current = false
    setPane(null)
    // Two restore attempts: the rAF can fire before the feed is back in the
    // DOM (the short reader clamps any scroll to ~0), so a second assert
    // runs after the swap has definitely laid out. No-op when the first won.
    const y = feedScrollRef.current
    requestAnimationFrame(() => window.scrollTo(0, y))
    setTimeout(() => window.scrollTo(0, y), 200)
  }, [])

  // While reading, the PROOFOFWRITING banner means "back to the feed" — catch
  // it before the topbar's own handler (which would reload the page).
  useEffect(() => {
    if (!pane) return
    const onCapture = (e) => {
      if (e.target.closest?.('.wordmark')) {
        e.preventDefault()
        e.stopPropagation()
        closeReader()
      }
    }
    document.addEventListener('click', onCapture, true)
    return () => document.removeEventListener('click', onCapture, true)
  }, [pane, closeReader])

  // The mobile Feed/Forums strip sticks directly under the sticky topbar. Pin it
  // to the topbar's EXACT rendered height (as a CSS var) so its resting position
  // and its stuck position are identical — otherwise a hardcoded offset that's a
  // hair off makes the space above the labels shift by a pixel the moment it
  // pins. Re-measures on resize + font-load reflow.
  useEffect(() => {
    const root = document.querySelector('.pow-feed')
    const bar = root?.querySelector('.topbar')
    if (!root || !bar) return
    const sync = () => {
      root.style.setProperty('--topbar-h', `${bar.getBoundingClientRect().height}px`)
    }
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(bar)
    window.addEventListener('resize', sync)
    if (document.fonts?.ready) document.fonts.ready.then(sync).catch(() => {})
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', sync)
    }
  }, [])
  // Paying to post mints a session; if we didn't have one at SSR time, the post
  // we just made proves who we are — adopt its account so delete shows at once.
  const [viewerAccountId, setViewerAccountId] = useState(initialViewerAccountId)
  const signedIn = viewerAccountId != null

  // Each tab keeps its own posts + keyset cursor so switching back doesn't
  // refetch. nextCursor is the opaque "fetch older than this" token from the
  // server; null means we've reached the end (no Load more).
  const [tabs, setTabs] = useState({
    foryou: {
      posts: initialPosts,
      nextCursor: initialNextCursor,
      error: initialLoadError,
      loaded: true,
    },
    // The Forums tab renders a directory (not a post feed); this slot exists only
    // so `tabs[scope]` is defined when the tab is active.
    forums: {
      posts: [],
      nextCursor: null,
      error: null,
      loaded: true,
    },
  })
  const [loading, setLoading] = useState(false)

  // "N new posts" banner for For You. Tracks the newest (created_at, id) among
  // posts already loaded — NOT the top of the displayed (ranked) order, since
  // ranking can put an older post above a newer one that's simply lower-scored;
  // using that would false-positive "new" on content already in hand. Polled
  // rather than pushed: at real post volume (~1/hour) a light interval is far
  // cheaper than a websocket for something this low-stakes.
  const foryouNewestRef = useRef(null)
  useEffect(() => {
    let best = null
    for (const p of tabs.foryou.posts) {
      if (!p || p.mintDigest || !p.created_at || !p.id) continue
      if (!best || p.created_at > best.t || (p.created_at === best.t && p.id > best.i)) {
        best = { t: p.created_at, i: p.id }
      }
    }
    foryouNewestRef.current = best
  }, [tabs.foryou.posts])

  const [newCount, setNewCount] = useState(0)
  const [loadingNew, setLoadingNew] = useState(false)

  const checkForNew = useCallback(async () => {
    const boundary = foryouNewestRef.current
    if (!boundary) return
    try {
      const qs = new URLSearchParams({ t: boundary.t, i: boundary.i })
      const res = await fetch(`/api/feed/new-count?${qs}`, { cache: 'no-store' })
      if (!res.ok) return
      const data = await res.json()
      setNewCount(data.count ?? 0)
    } catch {
      /* best-effort — the banner just stays as it was */
    }
  }, [])

  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') void checkForNew()
    }, 45000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void checkForNew()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [checkForNew])

  // Opportunistically nudge the reconcile sweep on load: it promotes provisional
  // (0-conf) posts/reactions once their tx finalizes and removes any that never
  // did. Fire-and-forget and rate-limited server-side; a Vercel Cron also runs
  // it, so this just keeps things tidy promptly regardless of cron cadence.
  useEffect(() => {
    fetch('/api/feed/reconcile', { cache: 'no-store' }).catch(() => {})
  }, [])

  const active = tabs[scope]

  const patchTab = useCallback((key, patch) => {
    setTabs((prev) => ({
      ...prev,
      [key]: typeof patch === 'function' ? patch(prev[key]) : { ...prev[key], ...patch },
    }))
  }, [])

  // Freshness: float posts you've already SEEN (scrolled past on a prior visit)
  // below the unseen ones, so a return visit doesn't lead with the same post. The
  // seen map is snapshotted ONCE on mount (so the list can't reshuffle under you
  // as you scroll and mark new posts) and reused for load-more pages. Runs after
  // hydration (localStorage is client-only), so the SSR order paints first, then
  // the unseen-first reorder settles in — same as the viewer-state overlay.
  const seenSnapshotRef = useRef(null)
  useEffect(() => {
    const snap = getSeenMap()
    seenSnapshotRef.current = snap
    if (Object.keys(snap).length === 0) return
    patchTab('foryou', (t) => ({ ...t, posts: reorderBySeen(t.posts, snap) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The For You feed is served from a shared, viewer-neutral cache, so its posts
  // arrive with like/repost/follow states blanked out. Once mounted (and whenever
  // the visible set changes), a signed-in viewer fetches just their own slice —
  // which of these posts they've liked/reposted and which authors they follow —
  // and we merge it in so the hearts and Follow buttons reflect reality. Keyed on
  // the txid set (not the post objects) so merging flags in doesn't re-trigger it.
  const foryouPosts = tabs.foryou.posts
  const foryouKey = foryouPosts.map((p) => p.txid).join(',')
  useEffect(() => {
    if (!signedIn || foryouPosts.length === 0) return
    let cancelled = false
    // The mint digest is a synthetic row (its txid is a made-up stable key, and
    // it has no author) — skip it; the server has no state to report for it.
    const realPosts = foryouPosts.filter((p) => !p.mintDigest)
    const txids = realPosts.map((p) => p.txid).filter(Boolean)
    // Include every account whose content is visible ON each post, not just the
    // post's own author: the cached feed is viewer-neutral, so a blocked account
    // can be the author of a teaser reply (topReply), a quoted post, a linked-post
    // embed, or the reply parent riding inside a NON-blocked post. Sending all of
    // them lets the server flag which are blocked, so we can scrub each embed below
    // (the outer post stays unless ITS author is blocked).
    const authorIds = [
      ...new Set(
        realPosts
          .flatMap((p) => [
            p.author_account_id,
            p.topReply?.author_account_id,
            p.quoted?.author_account_id,
            p.linkedPost?.author_account_id,
            p.parent?.author_account_id,
          ])
          .filter(Boolean),
      ),
    ]
    ;(async () => {
      try {
        const res = await fetch('/api/feed/viewer-state', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ txids, authorIds }),
        })
        if (!res.ok) return
        const data = await res.json()
        if (cancelled) return
        const liked = new Set(data.liked ?? [])
        const reposted = new Set(data.reposted ?? [])
        const followed = new Set(data.followed ?? [])
        const blocked = new Set(data.blocked ?? [])
        patchTab('foryou', (t) => ({
          ...t,
          // The cached feed is viewer-neutral, so it can include authors this
          // viewer has blocked (or who blocked them). Drop those here, then merge
          // the like/repost/follow flags onto what remains.
          posts: t.posts
            .filter((p) => !blocked.has(p.author_account_id))
            .map((p) => ({
              ...p,
              likedByViewer: liked.has(p.txid),
              repostedByViewer: reposted.has(p.txid),
              followedByViewer: followed.has(p.author_account_id),
              // The post stays (its own author isn't blocked), but scrub any
              // embed authored by a blocked account — teaser reply, quoted post,
              // linked-post embed, or reply parent.
              topReply: blocked.has(p.topReply?.author_account_id) ? null : p.topReply,
              quoted: blocked.has(p.quoted?.author_account_id) ? null : p.quoted,
              linkedPost: blocked.has(p.linkedPost?.author_account_id) ? null : p.linkedPost,
              parent: blocked.has(p.parent?.author_account_id) ? null : p.parent,
            })),
        }))
      } catch {
        /* overlay is best-effort; feed still renders without it */
      }
    })()
    return () => {
      cancelled = true
    }
    // foryouKey captures the visible txid set; foryouPosts is read fresh per run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foryouKey, signedIn, patchTab])

  const fetchScope = useCallback(
    async (key, cursor) => {
      const qs = new URLSearchParams()
      if (cursor) qs.set('cursor', cursor)
      if (key === 'following') qs.set('scope', 'following')
      const suffix = qs.toString()
      const res = await fetch(`/api/feed${suffix ? `?${suffix}` : ''}`, { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load feed')
      return data
    },
    [],
  )

  const selectScope = useCallback(
    async (key) => {
      const reselect = key === scope
      setScope(key)
      // Forums is a directory, not a post feed — nothing to fetch here.
      if (key === 'forums') return
      // Re-tapping the active Feed tab refreshes it: jump to the top, pull a
      // fresh page 1, replace the posts, and clear the "new posts" pill.
      if (reselect) {
        if (loading) return
        if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
        setLoading(true)
        try {
          const data = await fetchScope(key, null)
          patchTab(key, {
            posts: data.posts ?? [],
            nextCursor: data.nextCursor ?? null,
            error: null,
            loaded: true,
          })
          setNewCount(0)
        } catch (e) {
          patchTab(key, { error: e?.message || 'Failed to refresh feed' })
        } finally {
          setLoading(false)
        }
        return
      }
      if (tabs[key].loaded || loading) return
      setLoading(true)
      try {
        const data = await fetchScope(key, null)
        patchTab(key, {
          posts: data.posts ?? [],
          nextCursor: data.nextCursor ?? null,
          error: null,
          loaded: true,
        })
      } catch (e) {
        patchTab(key, { error: e?.message || 'Failed to load feed', loaded: true })
      } finally {
        setLoading(false)
      }
    },
    [scope, tabs, loading, fetchScope, patchTab],
  )

  const prependPost = useCallback(
    (post) => {
      if (!post?.txid) return
      if (post.author_account_id) {
        setViewerAccountId((cur) => cur ?? post.author_account_id)
      }
      // A new top-level post belongs to For You; also show it under Following
      // if it's already loaded (you follow yourself implicitly at the UI level).
      patchTab('foryou', (t) =>
        t.posts.some((p) => p.txid === post.txid) ? t : { ...t, posts: [post, ...t.posts] },
      )
      // Land the author on their new post: it sits at the top of the feed, so
      // bring the viewport up to it — a quote fired from deep in the feed would
      // otherwise slot in off-screen with nothing to show for the payment.
      if (typeof window !== 'undefined') {
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }
    },
    [patchTab],
  )

  // On mobile the inline composer is hidden, so a shared-draft link (?share=) or a
  // focus request must open the bottom-sheet composer instead. Desktop's inline
  // composer handles those itself (autoFocus), so only act at the mobile width.
  useEffect(() => {
    if (!(initialCompose || focusCompose)) return
    if (typeof window !== 'undefined' && window.matchMedia?.('(max-width:600px)').matches) {
      setComposeOpen(true)
    }
  }, [initialCompose, focusCompose])

  const removePost = useCallback(
    (txid) => {
      setTabs((prev) => {
        const next = {}
        for (const key of Object.keys(prev)) {
          next[key] = { ...prev[key], posts: prev[key].posts.filter((p) => p.txid !== txid) }
        }
        return next
      })
    },
    [],
  )

  // Blocking an account drops every post of theirs from both tabs at once (the
  // server-side filters keep them gone on the next fetch).
  const removeByAuthor = useCallback(
    (accountId) => {
      if (!accountId) return
      setTabs((prev) => {
        const next = {}
        for (const key of Object.keys(prev)) {
          next[key] = {
            ...prev[key],
            posts: prev[key].posts.filter((p) => p.author_account_id !== accountId),
          }
        }
        return next
      })
    },
    [],
  )

  const loadMore = useCallback(async () => {
    if (loading || !active.nextCursor) return
    setLoading(true)
    patchTab(scope, { error: null })
    try {
      const data = await fetchScope(scope, active.nextCursor)
      patchTab(scope, (t) => {
        const loaded = new Set(t.posts.map((p) => p.txid))
        let fresh = (data.posts ?? []).filter((p) => p?.txid && !loaded.has(p.txid))
        // Keep the unseen-first ordering going for load-more pages too (For You).
        if (scope === 'foryou' && seenSnapshotRef.current) {
          fresh = reorderBySeen(fresh, seenSnapshotRef.current)
        }
        return {
          ...t,
          posts: [...t.posts, ...fresh],
          nextCursor: data.nextCursor ?? null,
        }
      })
    } catch (e) {
      patchTab(scope, { error: e?.message || 'Failed to load more' })
    } finally {
      setLoading(false)
    }
  }, [loading, active, scope, fetchScope, patchTab])

  // Banner click: fetch the current top window and prepend whatever's genuinely
  // new (dedup by txid) ahead of what's already loaded, rather than replacing
  // the tab — a "Load more" still resumes from the same nextCursor after this.
  const loadNewer = useCallback(async () => {
    if (loadingNew) return
    setLoadingNew(true)
    try {
      const data = await fetchScope('foryou', null)
      patchTab('foryou', (t) => {
        const seen = new Set(t.posts.map((p) => p.txid))
        const fresh = (data.posts ?? []).filter((p) => p?.txid && !seen.has(p.txid))
        return fresh.length ? { ...t, posts: [...fresh, ...t.posts] } : t
      })
      setNewCount(0)
      if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch {
      /* leave the banner up so the user can retry */
    } finally {
      setLoadingNew(false)
    }
  }, [loadingNew, fetchScope, patchTab])

  return (
    <div className="pow-feed has-rail">
      <style>{FEED_CSS}</style>

      <FeedTopbar signedIn={signedIn} isAuthor={isAuthor} />

      {/* Desktop shell: one grid — the front page (≥1280px) on the left, the
          feed column at its usual 640px, the live activity rail (≥1100px) on
          the right. Hidden rails aren't grid items, so each tier lays out
          cleanly; below 1100px this wrapper is a plain block and phones
          render exactly as before. */}
      <div className="feed-cols">
      <aside className="feed-left" aria-label="The front page — long-form writing">
        <ArticleRail
          currentSlug={pane?.kind === 'article' ? pane.slug : null}
          onOpenStory={openStory}
        />
      </aside>
      <main className="wrap feed-main">
        {pane?.kind === 'article' ? (
          <HomeReader key={pane.slug} slug={pane.slug} onClose={closeReader} />
        ) : null}
        {pane?.kind === 'thread' ? (
          <ThreadPane txid={pane.txid} seed={pane.seed ?? null} onClose={closeReader} onOpenThread={wideShell ? openThread : undefined} />
        ) : null}
        <div style={pane ? { display: 'none' } : undefined}>
        {/* The front page, reflowed above the feed below 1280px (CSS-hidden at
            wider widths where the left rail carries it). Its own matchMedia gate
            means only one placement fetches at a time. */}
        <div className="feed-topstories">
          <ArticleRail variant="top" />
        </div>
        {/* The site-wide composer posts to the global Feed; on the Forums tab
            (a directory) there's no global post to make — you post inside a
            forum, on its own page — so it's hidden there. */}
        {scope !== 'forums' ? (
          <div className="feed-compose-inline">
            <ComposeBox
              action="post"
              onPosted={prependPost}
              initialContent={initialCompose}
              autoFocus={Boolean(initialCompose) || focusCompose}
              allowOptimistic
            />
          </div>
        ) : null}

        <div className="tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={scope === 'foryou'}
            className={`tab${scope === 'foryou' ? ' on' : ''}`}
            onClick={() => void selectScope('foryou')}
          >
            Feed
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={scope === 'forums'}
            className={`tab${scope === 'forums' ? ' on' : ''}`}
            onClick={() => void selectScope('forums')}
          >
            Forums
          </button>
        </div>

        {scope === 'forums' ? (
          <ForumDirectory signedIn={signedIn} />
        ) : (
          <>
            {newCount > 0 ? (
              <div className="newposts">
                <button
                  type="button"
                  className="newposts-pill"
                  onClick={() => void loadNewer()}
                  disabled={loadingNew}
                >
                  {loadingNew ? (
                    <span className="newposts-label">Loading…</span>
                  ) : (
                    <>
                      <span className="newposts-chev" aria-hidden="true">↑</span>
                      <span className="newposts-label">
                        {newCount}
                        {newCount >= 50 ? '+' : ''} new post{newCount === 1 ? '' : 's'}
                      </span>
                    </>
                  )}
                </button>
              </div>
            ) : null}

            {active.error ? <div className="error">{active.error}</div> : null}

            {loading && !active.loaded ? (
              <div className="empty">Loading…</div>
            ) : active.posts.length === 0 ? (
              <div className="empty">No posts yet. Be the first to post.</div>
            ) : (
              <ul className="panel posts">
                {active.posts.map((post) =>
                  post.mintDigest ? (
                    <MintDigestRow key={post.txid} digest={post} />
                  ) : (
                    <FeedPost
                      key={post.txid}
                      post={post}
                      viewerAccountId={viewerAccountId}
                      onDeleted={removePost}
                      onQuoted={prependPost}
                      onBlocked={removeByAuthor}
                      mintVariant="compact"
                      onOpenThread={wideShell ? openThread : undefined}
                      markSeenOnView={scope === 'foryou'}
                    />
                  ),
                )}
              </ul>
            )}

            {active.nextCursor ? (
              <div className="loadmore">
                <button type="button" onClick={() => void loadMore()} disabled={loading} className="ghost">
                  {loading ? 'Loading…' : 'Load more'}
                </button>
              </div>
            ) : null}
          </>
        )}
        </div>
      </main>

      <aside className="feed-rail" aria-label="Live on-chain activity">
        <ActivityRail
          onOpenThread={wideShell ? openThread : undefined}
          onOpenArticle={wideShell ? openStory : undefined}
        />
      </aside>
      </div>

      {/* Mobile compose button (CSS-hidden ≥600px): the POWR pen-nib on a neon
          disc, opening the composer as a bottom sheet. Hidden on the Forums tab,
          where posting happens inside a forum, not globally. */}
      {scope !== 'forums' ? (
        <button
          type="button"
          className="feed-fab"
          aria-label="New post"
          onClick={() => setComposeOpen(true)}
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path className="pnib" d="M4 20l1.2-4L15 6.2l2.8 2.8L8 18.8 4 20z" />
            <path className="pcut" d="M5.2 16L8 18.8" />
            <path className="pnib" d="M15 6.2l2-2a2 2 0 012.8 2.8l-2 2" />
          </svg>
        </button>
      ) : null}

      {composeOpen ? (
        <div className="feed-sheet-backdrop" onClick={() => setComposeOpen(false)}>
          <div className="feed-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="feed-sheet-head">
              <button
                type="button"
                className="feed-sheet-close"
                aria-label="Close"
                onClick={() => setComposeOpen(false)}
              >
                ✕
              </button>
            </div>
            <ComposeBox
              action="post"
              onPosted={(p) => {
                prependPost(p)
                setComposeOpen(false)
              }}
              initialContent={initialCompose}
              autoFocus
              allowOptimistic
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}
