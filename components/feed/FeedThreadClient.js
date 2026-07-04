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

export default function FeedThreadClient({ initialPost, initialReplies = [] }) {
  const [replies, setReplies] = useState(initialReplies)

  const addReply = useCallback((reply) => {
    if (!reply?.txid) return
    setReplies((prev) => {
      if (prev.some((r) => r.txid === reply.txid)) return prev
      return [...prev, reply]
    })
  }, [])

  const post = initialPost
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
          <p className="rootbody">{post.content}</p>
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
              <FeedPost key={reply.txid} post={reply} />
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}
