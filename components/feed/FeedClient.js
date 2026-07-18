'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import ActivityRail from '@/components/feed/ActivityRail'
import ArticleRail from '@/components/feed/ArticleRail'
import ComposeBox from '@/components/feed/ComposeBox'
import FeedPost, { MintDigestRow } from '@/components/feed/FeedPost'
import FeedTopbar from '@/components/feed/FeedTopbar'
import HomeReader from '@/components/feed/HomeReader'
import ThreadPane from '@/components/feed/ThreadPane'
import { FEED_CSS } from '@/components/feed/feedTheme'

export default function FeedClient({
  initialPosts = [],
  initialNextCursor = null,
  initialLoadError = null,
  viewerAccountId: initialViewerAccountId = null,
  isAuthor = false,
  initialCompose = '',
  focusCompose = false,
}) {
  const [scope, setScope] = useState('foryou') // 'foryou' | 'following'
  // The reading pane: a front-page story OR a feed thread open in the center
  // column, as pure client state — the URL stays put (no history games; the
  // App Router treats pushState as a navigation and fights the scroll
  // restore). The feed below stays MOUNTED (hidden), so tabs/posts/scroll
  // all survive the detour; each pane's "Open full page ↗" link is the
  // shareable URL.
  const [pane, setPane] = useState(null) // {kind:'article',slug} | {kind:'thread',txid} | null
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
    (txid) => {
      const t = String(txid ?? '').trim().toLowerCase()
      if (/^[0-9a-f]{64}$/.test(t)) openPane({ kind: 'thread', txid: t })
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
    following: {
      posts: [],
      nextCursor: null,
      error: null,
      loaded: false,
    },
  })
  const [loading, setLoading] = useState(false)

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
    const authorIds = [...new Set(realPosts.map((p) => p.author_account_id).filter(Boolean))]
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
      setScope(key)
      if (key === 'following' && !signedIn) return
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
    [signedIn, tabs, loading, fetchScope, patchTab],
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
        const seen = new Set(t.posts.map((p) => p.txid))
        const fresh = (data.posts ?? []).filter((p) => p?.txid && !seen.has(p.txid))
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

  return (
    <div className="pow-feed has-rail">
      <style>{FEED_CSS}</style>

      <FeedTopbar signedIn={signedIn} isAuthor={isAuthor} />

      {/* Desktop shell: one grid — the front page (≥1400px) on the left, the
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
      <main className="wrap" style={{ paddingTop: '28px' }}>
        {pane?.kind === 'article' ? (
          <HomeReader key={pane.slug} slug={pane.slug} onClose={closeReader} />
        ) : null}
        {pane?.kind === 'thread' ? (
          <ThreadPane txid={pane.txid} onClose={closeReader} onOpenThread={wideShell ? openThread : undefined} />
        ) : null}
        <div style={pane ? { display: 'none' } : undefined}>
        <ComposeBox
          action="post"
          onPosted={prependPost}
          initialContent={initialCompose}
          autoFocus={Boolean(initialCompose) || focusCompose}
          allowOptimistic
        />

        <div className="tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={scope === 'foryou'}
            className={`tab${scope === 'foryou' ? ' on' : ''}`}
            onClick={() => void selectScope('foryou')}
          >
            For you
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={scope === 'following'}
            className={`tab${scope === 'following' ? ' on' : ''}`}
            onClick={() => void selectScope('following')}
          >
            Following
          </button>
        </div>

        {active.error ? <div className="error">{active.error}</div> : null}

        {scope === 'following' && !signedIn ? (
          <div className="empty">Post once to sign in, then follow writers to fill this tab.</div>
        ) : loading && !active.loaded ? (
          <div className="empty">Loading…</div>
        ) : active.posts.length === 0 ? (
          <div className="empty">
            {scope === 'following'
              ? 'No posts yet from people you follow.'
              : 'No posts yet. Be the first to post.'}
          </div>
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
        </div>
      </main>

      <aside className="feed-rail" aria-label="Live on-chain activity">
        <ActivityRail onOpenThread={wideShell ? openThread : undefined} />
      </aside>
      </div>
    </div>
  )
}
