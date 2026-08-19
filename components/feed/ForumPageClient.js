'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import ComposeBox from '@/components/feed/ComposeBox'
import FeedPost from '@/components/feed/FeedPost'
import FeedTopbar from '@/components/feed/FeedTopbar'
import ActivityRail from '@/components/feed/ActivityRail'
import ArticleRail from '@/components/feed/ArticleRail'
import { FEED_CSS } from '@/components/feed/feedTheme'

/**
 * A single forum's page: header (name/title/description/runner) + a composer that
 * posts INTO this forum + the forum's own post feed. Mirrors the feed shell but
 * scoped to one forum_id. Posting here tags the post to the forum (so it stays
 * contained to /f/<slug>, never the global Feed); replies + positive reactions on
 * these posts pay the forum runner the 6% engagement fee (server-derived).
 */
export default function ForumPageClient({
  forum,
  forumId,
  initialPosts = [],
  initialNextCursor = null,
  viewerAccountId: initialViewerAccountId = null,
  isAuthor = false,
}) {
  const [posts, setPosts] = useState(initialPosts)
  const [nextCursor, setNextCursor] = useState(initialNextCursor)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [viewerAccountId, setViewerAccountId] = useState(initialViewerAccountId)
  const signedIn = viewerAccountId != null

  const prependPost = useCallback((post) => {
    if (!post?.txid) return
    if (post.author_account_id) {
      setViewerAccountId((cur) => cur ?? post.author_account_id)
    }
    setPosts((prev) => (prev.some((p) => p.txid === post.txid) ? prev : [post, ...prev]))
  }, [])

  const removePost = useCallback((txid) => {
    setPosts((prev) => prev.filter((p) => p.txid !== txid))
  }, [])

  const removeByAuthor = useCallback((accountId) => {
    if (!accountId) return
    setPosts((prev) => prev.filter((p) => p.author_account_id !== accountId))
  }, [])

  const loadMore = useCallback(async () => {
    if (loading || !nextCursor) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/forums/${encodeURIComponent(forum.slug)}/feed?cursor=${encodeURIComponent(nextCursor)}`,
        { cache: 'no-store' },
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load more')
      setPosts((prev) => {
        const seen = new Set(prev.map((p) => p.txid))
        return [...prev, ...(data.posts ?? []).filter((p) => !seen.has(p.txid))]
      })
      setNextCursor(data.nextCursor ?? null)
    } catch (e) {
      setError(e?.message || 'Failed to load more')
    } finally {
      setLoading(false)
    }
  }, [loading, nextCursor, forum.slug])

  // Per-viewer like/repost/follow overlay — the SSR page is viewer-neutral for
  // these flags, same as the global Feed. Best-effort; the feed renders without it.
  const visibleKey = useMemo(() => posts.map((p) => p.txid).join(','), [posts])
  const overlayRef = useRef('')
  useEffect(() => {
    if (!signedIn || posts.length === 0) return undefined
    if (overlayRef.current === visibleKey) return undefined
    overlayRef.current = visibleKey
    let cancelled = false
    const real = posts.filter((p) => p.txid && !p.mintDigest)
    const txids = real.map((p) => p.txid)
    const authorIds = [
      ...new Set(
        real
          .flatMap((p) => [
            p.author_account_id,
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
        setPosts((prev) =>
          prev
            .filter((p) => !blocked.has(p.author_account_id))
            .map((p) => ({
              ...p,
              likedByViewer: liked.has(p.txid),
              repostedByViewer: reposted.has(p.txid),
              followedByViewer: followed.has(p.author_account_id),
              quoted: blocked.has(p.quoted?.author_account_id) ? null : p.quoted,
              linkedPost: blocked.has(p.linkedPost?.author_account_id) ? null : p.linkedPost,
              parent: blocked.has(p.parent?.author_account_id) ? null : p.parent,
            })),
        )
      } catch {
        /* best-effort */
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleKey, signedIn])

  return (
    <div className="pow-feed has-rail">
      <style>{FEED_CSS}</style>

      <FeedTopbar signedIn={signedIn} isAuthor={isAuthor} />

      <div className="feed-cols">
        <aside className="feed-left" aria-label="The front page — long-form writing">
          <ArticleRail />
        </aside>
        <main className="wrap" style={{ paddingTop: '28px' }}>
          <div className="forumhead">
            <Link href="/" className="forumhead-back">
              ← Forums
            </Link>
            <h1 className="forumhead-name">/f/{forum.slug}</h1>
            <p className="forumhead-title">{forum.title}</p>
            {forum.description ? <p className="forumhead-desc">{forum.description}</p> : null}
            <div className="forumhead-meta">
              <span>
                {forum.postCount} post{forum.postCount === 1 ? '' : 's'}
              </span>
              {forum.runner ? (
                <span>
                  runner{' '}
                  <Link href={`/${forum.runner}`} className="forumhead-runner">
                    {forum.runner}
                  </Link>
                </span>
              ) : null}
              {forum.isRunner ? <span className="forumhead-youtag">you run this</span> : null}
            </div>
          </div>

          {signedIn ? (
            <ComposeBox
              action="post"
              forumId={forumId}
              onPosted={prependPost}
              allowOptimistic
              placeholder={`Post in /f/${forum.slug}…`}
            />
          ) : (
            <div className="empty">Post once to sign in, then post here.</div>
          )}

          {error ? <div className="error">{error}</div> : null}

          {posts.length === 0 ? (
            <div className="empty">No posts in this forum yet. Be the first.</div>
          ) : (
            <ul className="panel posts">
              {posts.map((post) => (
                <FeedPost
                  key={post.txid}
                  post={post}
                  viewerAccountId={viewerAccountId}
                  onDeleted={removePost}
                  onQuoted={prependPost}
                  onBlocked={removeByAuthor}
                  mintVariant="compact"
                  allowOptimisticQuote
                />
              ))}
            </ul>
          )}

          {nextCursor ? (
            <div className="loadmore">
              <button type="button" onClick={() => void loadMore()} disabled={loading} className="ghost">
                {loading ? 'Loading…' : 'Load more'}
              </button>
            </div>
          ) : null}
        </main>
        <aside className="feed-rail" aria-label="Live on-chain activity">
          <ActivityRail />
        </aside>
      </div>
    </div>
  )
}
