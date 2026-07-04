'use client'

import { useCallback, useState } from 'react'
import Link from 'next/link'
import ComposeBox from '@/components/feed/ComposeBox'
import FeedPost from '@/components/feed/FeedPost'
import { FEED_CSS } from '@/components/feed/feedTheme'

export default function FeedClient({
  initialPosts = [],
  initialHasNextPage = false,
  initialPage = 1,
  initialLoadError = null,
}) {
  const [posts, setPosts] = useState(initialPosts)
  const [hasNextPage, setHasNextPage] = useState(initialHasNextPage)
  const [page, setPage] = useState(initialPage)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(initialLoadError)

  const prependPost = useCallback((post) => {
    if (!post?.txid) return
    setPosts((prev) => {
      if (prev.some((p) => p.txid === post.txid)) return prev
      return [post, ...prev]
    })
  }, [])

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasNextPage) return
    setLoadingMore(true)
    setError(null)
    try {
      const nextPage = page + 1
      const res = await fetch(`/api/feed?page=${nextPage}`, { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load more')
      setPosts((prev) => {
        const seen = new Set(prev.map((p) => p.txid))
        const fresh = (data.posts ?? []).filter((p) => p?.txid && !seen.has(p.txid))
        return [...prev, ...fresh]
      })
      setHasNextPage(Boolean(data.hasNextPage))
      setPage(nextPage)
    } catch (e) {
      setError(e?.message || 'Failed to load more')
    } finally {
      setLoadingMore(false)
    }
  }, [loadingMore, hasNextPage, page])

  return (
    <div className="pow-feed">
      <style>{FEED_CSS}</style>

      <div className="topbar">
        <Link href="/" className="wordmark">
          proofofwriting
        </Link>
        <Link href="/mint" className="toplink">
          mint a handle
        </Link>
      </div>

      <div className="head">
        <p className="eyebrow">proofofwriting // feed</p>
        <h1 className="title">Feed</h1>
        <p className="sub">Pay to post. Every word is on-chain. Replies pay the author.</p>
      </div>

      <main className="wrap">
        <ComposeBox action="post" onPosted={prependPost} />

        {error ? <div className="error">{error}</div> : null}

        {posts.length === 0 ? (
          <div className="empty">No posts yet. Be the first to post.</div>
        ) : (
          <ul className="panel posts">
            {posts.map((post) => (
              <FeedPost key={post.txid} post={post} />
            ))}
          </ul>
        )}

        {hasNextPage ? (
          <div className="loadmore">
            <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="ghost">
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          </div>
        ) : null}
      </main>
    </div>
  )
}
