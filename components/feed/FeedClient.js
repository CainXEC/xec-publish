'use client'

import { useCallback, useEffect, useState } from 'react'
import ComposeBox from '@/components/feed/ComposeBox'
import FeedPost from '@/components/feed/FeedPost'
import FeedTopbar from '@/components/feed/FeedTopbar'
import { FEED_CSS } from '@/components/feed/feedTheme'

export default function FeedClient({
  initialPosts = [],
  initialNextCursor = null,
  initialLoadError = null,
  viewerAccountId: initialViewerAccountId = null,
  isAuthor = false,
  initialCompose = '',
}) {
  const [scope, setScope] = useState('foryou') // 'foryou' | 'following'
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
    const txids = foryouPosts.map((p) => p.txid).filter(Boolean)
    const authorIds = [...new Set(foryouPosts.map((p) => p.author_account_id).filter(Boolean))]
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
    <div className="pow-feed">
      <style>{FEED_CSS}</style>

      <FeedTopbar signedIn={signedIn} isAuthor={isAuthor} />

      <main className="wrap" style={{ paddingTop: '28px' }}>
        <ComposeBox
          action="post"
          onPosted={prependPost}
          initialContent={initialCompose}
          autoFocus={Boolean(initialCompose)}
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
            {active.posts.map((post) => (
              <FeedPost
                key={post.txid}
                post={post}
                viewerAccountId={viewerAccountId}
                onDeleted={removePost}
                onQuoted={prependPost}
                onBlocked={removeByAuthor}
              />
            ))}
          </ul>
        )}

        {active.nextCursor ? (
          <div className="loadmore">
            <button type="button" onClick={() => void loadMore()} disabled={loading} className="ghost">
              {loading ? 'Loading…' : 'Load more'}
            </button>
          </div>
        ) : null}
      </main>
    </div>
  )
}
