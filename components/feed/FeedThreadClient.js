'use client'

import { useCallback, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import ComposeBox from '@/components/feed/ComposeBox'
import FeedPost from '@/components/feed/FeedPost'
import EngagementBar from '@/components/feed/EngagementBar'
import QuotedEmbed from '@/components/feed/QuotedEmbed'
import { FEED_CSS } from '@/components/feed/feedTheme'

function truncateAddress(addr) {
  const t = String(addr ?? '').trim()
  if (t.length <= 16) return t
  return `${t.slice(0, 10)}…${t.slice(-4)}`
}

function timeAgo(iso) {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
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

/**
 * One post in the ancestor chain above the focused post. Twitter-style: a left
 * rail with a node dot and a connecting line down to the next post. The whole
 * card navigates to that post's own thread.
 */
function AncestorNode({ post, top = false }) {
  const router = useRouter()
  const go = (e) => {
    if (e.target.closest('a, button')) return
    router.push(`/feed/${post.txid}`)
  }
  return (
    <div
      className={`tnode linedown${top ? '' : ' lineup'}`}
      onClick={go}
      role="link"
      tabIndex={0}
      style={{ cursor: 'pointer' }}
    >
      <div className="trail">
        <span className="tdot" />
      </div>
      <div className="tbody">
        <div className="tmeta">
          <ThreadByline identity={post.author_identity} />
          <span aria-hidden className="dot">
            ·
          </span>
          <span className="time">{timeAgo(post.created_at)}</span>
        </div>
        <p className="ttext">
          {post.deleted ? <span className="tombstone">This post was deleted.</span> : post.content}
        </p>
        {post.quoted_txid ? <QuotedEmbed post={post.quoted ?? null} /> : null}
      </div>
    </div>
  )
}

export default function FeedThreadClient({
  initialPost,
  initialAncestors = [],
  initialReplies = [],
  viewerAccountId: initialViewerAccountId = null,
}) {
  const router = useRouter()
  const [replies, setReplies] = useState(initialReplies)
  const [viewerAccountId, setViewerAccountId] = useState(initialViewerAccountId)
  const [rootDeleted, setRootDeleted] = useState(Boolean(initialPost?.deleted))
  const [deletingRoot, setDeletingRoot] = useState(false)
  const [showReply, setShowReply] = useState(false)
  const [showQuote, setShowQuote] = useState(false)

  const addReply = useCallback((reply) => {
    if (!reply?.txid) return
    if (reply.author_account_id) {
      setViewerAccountId((cur) => cur ?? reply.author_account_id)
    }
    setShowReply(false)
    setReplies((prev) => {
      if (prev.some((r) => r.txid === reply.txid)) return prev
      return [...prev, reply]
    })
  }, [])

  const removeReply = useCallback((txid) => {
    setReplies((prev) => prev.filter((r) => r.txid !== txid))
  }, [])

  // A quote is a new top-level post; jump to its thread once it's recorded.
  const handleQuoted = useCallback(
    (quote) => {
      setShowQuote(false)
      if (quote?.txid) router.push(`/feed/${quote.txid}`)
    },
    [router],
  )

  const post = initialPost
  const ancestors = initialAncestors
  const hasAncestors = ancestors.length > 0

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
        <div className="toplinks">
          <Link href="/articles" className="toplink">
            articles
          </Link>
          <Link href="/mint" className="toplink">
            mint a handle
          </Link>
        </div>
      </div>

      <main className="wrap" style={{ paddingTop: '28px' }}>
        <Link href="/" className="back">
          ← Back to feed
        </Link>

        <div className="thread">
          {ancestors.map((a, i) => (
            <AncestorNode key={a.txid} post={a} top={i === 0} />
          ))}

          {/* Focused post: emphasized, and joined to the chain above by a line. */}
          <article className={`tnode focused${hasAncestors ? ' lineup' : ''}`}>
            <div className="trail">
              <span className="tdot" />
            </div>
            <div className="tbody">
              <div className="tmeta">
                <ThreadByline identity={post.author_identity} />
              </div>
              {rootDeleted ? (
                <p className="focusbody tombstone">This post was deleted.</p>
              ) : (
                <p className="focusbody">{post.content}</p>
              )}
              {post.quoted_txid ? <QuotedEmbed post={post.quoted ?? null} /> : null}
              <p className="focusmeta">
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
              <div className="actions">
                <button type="button" onClick={() => setShowReply((s) => !s)} className="replybtn">
                  💬 {replies.length > 0 ? replies.length : ''} Reply
                </button>
                {!rootDeleted ? (
                  <EngagementBar
                    targetTxid={post.txid}
                    likeCount={post.likeCount ?? 0}
                    repostCount={post.repostCount ?? 0}
                    likedByViewer={Boolean(post.likedByViewer)}
                    repostedByViewer={Boolean(post.repostedByViewer)}
                    onQuote={() => setShowQuote((s) => !s)}
                  />
                ) : null}
                {isOwnRoot ? (
                  <button
                    type="button"
                    onClick={handleDeleteRoot}
                    disabled={deletingRoot}
                    className="delbtn"
                  >
                    {deletingRoot ? 'Deleting…' : 'Delete'}
                  </button>
                ) : null}
              </div>
              {showReply ? (
                <div className="inlinereply">
                  <ComposeBox
                    action="reply"
                    parentTxid={post.txid}
                    autoFocus
                    compact
                    placeholder="Post your reply…"
                    onPosted={addReply}
                    onCancel={() => setShowReply(false)}
                  />
                </div>
              ) : null}
              {showQuote ? (
                <div className="inlinequote">
                  <ComposeBox
                    action="quote"
                    quotedTxid={post.txid}
                    quotedPost={post}
                    autoFocus
                    compact
                    onPosted={handleQuoted}
                    onCancel={() => setShowQuote(false)}
                  />
                </div>
              ) : null}
            </div>
          </article>
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
                onQuoted={handleQuoted}
              />
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}
