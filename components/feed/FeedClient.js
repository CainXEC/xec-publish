'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import ComposeBox from '@/components/feed/ComposeBox'
import FeedPost from '@/components/feed/FeedPost'
import { FEED_CSS } from '@/components/feed/feedTheme'
import ThemeToggle from '@/components/ThemeToggle'

export default function FeedClient({
  initialPosts = [],
  initialHasNextPage = false,
  initialPage = 1,
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

  // Each tab keeps its own posts/pagination so switching back doesn't refetch.
  const [tabs, setTabs] = useState({
    foryou: {
      posts: initialPosts,
      hasNextPage: initialHasNextPage,
      page: initialPage,
      error: initialLoadError,
      loaded: true,
    },
    following: {
      posts: [],
      hasNextPage: false,
      page: 1,
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

  const fetchScope = useCallback(
    async (key, page) => {
      const qs = new URLSearchParams({ page: String(page) })
      if (key === 'following') qs.set('scope', 'following')
      const res = await fetch(`/api/feed?${qs.toString()}`, { cache: 'no-store' })
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
        const data = await fetchScope(key, 1)
        patchTab(key, {
          posts: data.posts ?? [],
          hasNextPage: Boolean(data.hasNextPage),
          page: 1,
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

  const loadMore = useCallback(async () => {
    if (loading || !active.hasNextPage) return
    setLoading(true)
    patchTab(scope, { error: null })
    try {
      const nextPage = active.page + 1
      const data = await fetchScope(scope, nextPage)
      patchTab(scope, (t) => {
        const seen = new Set(t.posts.map((p) => p.txid))
        const fresh = (data.posts ?? []).filter((p) => p?.txid && !seen.has(p.txid))
        return {
          ...t,
          posts: [...t.posts, ...fresh],
          hasNextPage: Boolean(data.hasNextPage),
          page: nextPage,
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

      <div className="topbar">
        <Link href="/" className="wordmark">
          proofofwriting
        </Link>
        <div className="toplinks">
          {isAuthor ? (
            <Link href="/dashboard" className="toplink">
              dashboard
            </Link>
          ) : null}
          <Link href="/mint" className="toplink">
            mint a handle
          </Link>
          <ThemeToggle variant="feed" />
        </div>
      </div>

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
              />
            ))}
          </ul>
        )}

        {active.hasNextPage ? (
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
