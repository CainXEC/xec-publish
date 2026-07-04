'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import ComposeBox from '@/components/feed/ComposeBox'
import EngagementBar from '@/components/feed/EngagementBar'
import QuotedEmbed from '@/components/feed/QuotedEmbed'

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

function truncateAddress(addr) {
  const t = String(addr ?? '').trim()
  if (t.length <= 16) return t
  return `${t.slice(0, 10)}…${t.slice(-4)}`
}

// Long posts are clamped in the feed so one wall of text can't dominate the
// column. Clamp when the body runs past this many characters; the full text is
// always one tap away via "Show more" (or by opening the thread).
const FEED_CLAMP_CHARS = 280

/**
 * One feed post. The byline uses the identity stamped at write time
 * (author_identity): "@handle" links to the profile; a raw address is shown as
 * truncated monospace text.
 */
function Byline({ identity }) {
  const id = typeof identity === 'string' ? identity.trim() : ''
  if (id.startsWith('@')) {
    const handle = id.slice(1)
    return (
      <Link href={`/@${handle}`} className="byline">
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

export default function FeedPost({ post, onReplied, onQuoted, viewerAccountId = null, onDeleted }) {
  const router = useRouter()
  const [showReply, setShowReply] = useState(false)
  const [showQuote, setShowQuote] = useState(false)
  const [replyCount, setReplyCount] = useState(post.replyCount ?? 0)
  const [deleting, setDeleting] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const body = typeof post.content === 'string' ? post.content : ''
  const isLong = body.length > FEED_CLAMP_CHARS
  const shownBody = !isLong || expanded ? body : `${body.slice(0, FEED_CLAMP_CHARS).trimEnd()}…`

  const isOwn =
    !post.deleted &&
    !!viewerAccountId &&
    post.author_account_id === viewerAccountId

  const handleReplied = (reply) => {
    setShowReply(false)
    setReplyCount((c) => c + 1)
    onReplied?.(reply)
  }

  const handleQuoted = (quote) => {
    setShowQuote(false)
    onQuoted?.(quote)
  }

  const handleDelete = async () => {
    if (deleting) return
    if (!window.confirm('Delete this post? The on-chain record stays, but it will be removed from the feed.')) {
      return
    }
    setDeleting(true)
    try {
      const res = await fetch(`/api/feed/${post.txid}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to delete')
      onDeleted?.(post.txid)
    } catch (e) {
      window.alert(e?.message || 'Failed to delete')
      setDeleting(false)
    }
  }

  // Clicking anywhere on the post opens its thread, except on nested
  // interactive elements (the byline/timestamp links, the reply button, or the
  // inline reply composer).
  const openThread = (e) => {
    if (e.target.closest('a, button, input, textarea, .inlinereply, .inlinequote, .quoted, .engage')) {
      return
    }
    router.push(`/feed/${post.txid}`)
  }

  return (
    <li className="post" onClick={openThread} style={{ cursor: 'pointer' }}>
      <div className="postmeta">
        <Byline identity={post.author_identity} />
        <span aria-hidden className="dot">
          ·
        </span>
        <Link href={`/feed/${post.txid}`} className="time">
          {timeAgo(post.created_at)}
        </Link>
      </div>

      <p className="body">
        {shownBody}
        {isLong ? (
          <button
            type="button"
            className="showmore"
            onClick={() => setExpanded((s) => !s)}
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
        ) : null}
      </p>

      {post.quoted_txid ? <QuotedEmbed post={post.quoted ?? null} /> : null}

      <div className="actions">
        <button type="button" onClick={() => setShowReply((s) => !s)} className="replybtn">
          💬 {replyCount > 0 ? replyCount : ''} Reply
        </button>
        {!post.deleted ? (
          <EngagementBar
            targetTxid={post.txid}
            likeCount={post.likeCount ?? 0}
            repostCount={post.repostCount ?? 0}
            likedByViewer={Boolean(post.likedByViewer)}
            repostedByViewer={Boolean(post.repostedByViewer)}
            onQuote={() => setShowQuote((s) => !s)}
          />
        ) : null}
        {isOwn ? (
          <button type="button" onClick={handleDelete} disabled={deleting} className="delbtn">
            {deleting ? 'Deleting…' : 'Delete'}
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
            onPosted={handleReplied}
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
    </li>
  )
}
