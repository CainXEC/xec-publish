'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import ComposeBox from '@/components/feed/ComposeBox'

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

export default function FeedPost({ post, onReplied, viewerAccountId = null, onDeleted }) {
  const router = useRouter()
  const [showReply, setShowReply] = useState(false)
  const [replyCount, setReplyCount] = useState(post.replyCount ?? 0)
  const [deleting, setDeleting] = useState(false)

  const isOwn =
    !post.deleted &&
    !!viewerAccountId &&
    post.author_account_id === viewerAccountId

  const handleReplied = (reply) => {
    setShowReply(false)
    setReplyCount((c) => c + 1)
    onReplied?.(reply)
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
    if (e.target.closest('a, button, input, textarea, .inlinereply')) return
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

      <p className="body">{post.content}</p>

      <div className="actions">
        <button type="button" onClick={() => setShowReply((s) => !s)} className="replybtn">
          💬 {replyCount > 0 ? replyCount : ''} Reply
        </button>
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
    </li>
  )
}
