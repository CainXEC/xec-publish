'use client'

import { useCallback, useState } from 'react'
import Link from 'next/link'
import ComposeBox from '@/components/feed/ComposeBox'
import FeedPost from '@/components/feed/FeedPost'
import { FEED_CSS } from '@/components/feed/feedTheme'

function truncateAddress(addr) {
  const t = String(addr ?? '').trim()
  if (t.length <= 16) return t
  return `${t.slice(0, 10)}…${t.slice(-4)}`
}

function ThreadByline({ identity }) {
  const id = typeof identity === 'string' ? identity.trim() : ''
  if (id.startsWith('@')) {
    return (
      <Link href={`/@${id.slice(1)}`} className="byline">
        {id}
      </Link>
    )
  }
  return (
    <span className="addr" title={id}>
      {truncateAddress(id)}
    </span>
  )
}

export default function FeedThreadClient({
  initialPost,
  initialReplies = [],
  viewerAccountId: initialViewerAccountId = null,
}) {
  const [replies, setReplies] = useState(initialReplies)
  const [viewerAccountId, setViewerAccountId] = useState(initialViewerAccountId)
  const [rootDeleted, setRootDeleted] = useState(Boolean(initialPost?.deleted))
  const [deletingRoot, setDeletingRoot] = useState(false)

  const addReply = useCallback((reply) => {
    if (!reply?.txid) return
    if (reply.author_account_id) {
      setViewerAccountId((cur) => cur ?? reply.author_account_id)
    }
    setReplies((prev) => {
      if (prev.some((r) => r.txid === reply.txid)) return prev
      return [...prev, reply]
    })
  }, [])

  const removeReply = useCallback((txid) => {
    setReplies((prev) => prev.filter((r) => r.txid !== txid))
  }, [])

  const post = initialPost

  const isOwnRoot =
    !rootDeleted && !!viewerAccountId && post?.author_account_id === viewerAccountId

  const handleDeleteRoot = async () => {
    if (deletingRoot) return
    if (!window.confirm('Delete this post? The on-chain record stays, but it will be removed from the feed.')) {
      return
    }
    setDeletingRoot(true)
    try {
      const res = await fetch(`/api/feed/${post.txid}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to delete')
      setRootDeleted(true)
    } catch (e) {
      window.alert(e?.message || 'Failed to delete')
      setDeletingRoot(false)
    }
  }

  const createdAt = post?.created_at
    ? new Date(post.created_at).toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : ''

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

      <main className="wrap" style={{ paddingTop: '28px' }}>
        <Link href="/feed" className="back">
          ← Back to feed
        </Link>

        <article className="panel rootpost">
          <ThreadByline identity={post.author_identity} />
          {rootDeleted ? (
            <p className="rootbody tombstone">This post was deleted.</p>
          ) : (
            <p className="rootbody">{post.content}</p>
          )}
          <p className="rootmeta">
            {createdAt}
            {' · '}
            <a
              href={`https://explorer.e.cash/tx/${post.txid}`}
              target="_blank"
              rel="noreferrer"
              className="onchain"
            >
              on-chain
            </a>
            {isOwnRoot ? (
              <>
                {' · '}
                <button
                  type="button"
                  onClick={handleDeleteRoot}
                  disabled={deletingRoot}
                  className="delbtn"
                >
                  {deletingRoot ? 'Deleting…' : 'Delete'}
                </button>
              </>
            ) : null}
          </p>
        </article>

        <div style={{ marginTop: '16px' }}>
          <ComposeBox
            action="reply"
            parentTxid={post.txid}
            placeholder="Post your reply…"
            onPosted={addReply}
          />
        </div>

        <h2 className="replieshead">
          {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
        </h2>

        {replies.length === 0 ? (
          <p className="empty">No replies yet.</p>
        ) : (
          <ul className="panel posts">
            {replies.map((reply) => (
              <FeedPost
                key={reply.txid}
                post={reply}
                viewerAccountId={viewerAccountId}
                onDeleted={removeReply}
              />
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}
