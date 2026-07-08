'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import ComposeBox from '@/components/feed/ComposeBox'
import EngagementBar from '@/components/feed/EngagementBar'
import QuotedEmbed from '@/components/feed/QuotedEmbed'
import ArticleCard from '@/components/feed/ArticleCard'
import { extractArticleSlug, stripArticleLink } from '@/lib/articleLinks'

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
 * One feed post. The byline uses the poster's live identity (displayIdentity,
 * resolved from the account's current handle at load time; falls back to the
 * frozen author_identity for optimistic posts): "@handle" links to the profile;
 * a raw address is shown as truncated monospace text.
 */
function Byline({ identity, color }) {
  const id = typeof identity === 'string' ? identity.trim() : ''
  if (id.startsWith('@')) {
    const handle = id.slice(1)
    // A custom handle color (one of the theme swatches) overrides the default
    // neon byline; absent color keeps the CSS default.
    return (
      <Link href={`/@${handle}`} className="byline" style={color ? { color } : undefined}>
        {handle}
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
 * Overflow "···" menu on someone else's post: the single home for the two
 * relationship actions — Follow/Unfollow and Block. Both are session-authorized
 * and optimistic. Follow flips in place; Block confirms, then calls onBlocked so
 * the feed drops the account's posts immediately. Only rendered for a signed-in
 * viewer on another account's live post (unblocking is done from the profile).
 */
function PostMenu({ authorAccountId, authorLabel, initialFollowing, onBlocked }) {
  const [open, setOpen] = useState(false)
  const [following, setFollowing] = useState(Boolean(initialFollowing))
  const [busyFollow, setBusyFollow] = useState(false)
  const [busyBlock, setBusyBlock] = useState(false)
  const rootRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  const toggleFollow = useCallback(async () => {
    if (busyFollow) return
    const next = !following
    setBusyFollow(true)
    setFollowing(next) // optimistic
    try {
      const res = await fetch('/api/feed/follow', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ followeeAccountId: authorAccountId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) {
        setFollowing(!next) // revert
      } else if (typeof data.following === 'boolean') {
        setFollowing(data.following)
      }
    } catch {
      setFollowing(!next) // revert
    } finally {
      setBusyFollow(false)
    }
  }, [busyFollow, following, authorAccountId])

  const block = useCallback(async () => {
    if (busyBlock) return
    const who = authorLabel ? ` ${authorLabel}` : ''
    if (!window.confirm(`Block${who}? You won't see each other's posts, and they can't reply to you.`)) {
      return
    }
    setBusyBlock(true)
    try {
      const res = await fetch('/api/feed/block', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ blockedAccountId: authorAccountId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to block')
      setOpen(false)
      onBlocked?.(authorAccountId)
    } catch (e) {
      window.alert(e?.message || 'Failed to block')
      setBusyBlock(false)
    }
  }, [busyBlock, authorAccountId, authorLabel, onBlocked])

  return (
    <span className="postmenu" ref={rootRef}>
      <button
        type="button"
        className="menubtn"
        onClick={() => setOpen((s) => !s)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More"
      >
        ···
      </button>
      {open ? (
        <div className="menupop" role="menu">
          <button
            type="button"
            role="menuitem"
            className="menuitem"
            onClick={toggleFollow}
            disabled={busyFollow}
          >
            {busyFollow ? '…' : following ? 'Unfollow' : 'Follow'}
          </button>
          <button
            type="button"
            role="menuitem"
            className="menuitem danger"
            onClick={block}
            disabled={busyBlock}
          >
            {busyBlock ? 'Blocking…' : 'Block'}
          </button>
        </div>
      ) : null}
    </span>
  )
}

export default function FeedPost({ post, onReplied, onQuoted, viewerAccountId = null, onDeleted, onBlocked }) {
  const router = useRouter()
  const [showReply, setShowReply] = useState(false)
  const [showQuote, setShowQuote] = useState(false)
  const [replyCount, setReplyCount] = useState(post.replyCount ?? 0)
  const [quoteCount, setQuoteCount] = useState(post.quoteCount ?? 0)
  const [deleting, setDeleting] = useState(false)
  const [expanded, setExpanded] = useState(false)
  // Replies the viewer just posted, shown nested right here so they stay on the
  // feed instead of being navigated to the thread page.
  const [newReplies, setNewReplies] = useState([])

  const body = typeof post.content === 'string' ? post.content : ''
  // The article preview card is itself the link, so strip the raw article URL
  // from the displayed text. Keep `body` intact for the card's slug detection.
  const displayBody = extractArticleSlug(body) ? stripArticleLink(body) : body
  const isLong = displayBody.length > FEED_CLAMP_CHARS
  const shownBody =
    !isLong || expanded ? displayBody : `${displayBody.slice(0, FEED_CLAMP_CHARS).trimEnd()}…`

  const isOwn =
    !post.deleted &&
    !!viewerAccountId &&
    post.author_account_id === viewerAccountId

  // The overflow menu (Follow + Block) shows only to a signed-in viewer looking
  // at someone else's live post.
  const canManageAuthor =
    !post.deleted && !!viewerAccountId && !isOwn && !!post.author_account_id

  const authorLabel = (() => {
    const id = String(post.displayIdentity ?? post.author_identity ?? '').trim()
    return id.startsWith('@') ? id : ''
  })()

  const handleReplied = (reply) => {
    setShowReply(false)
    setReplyCount((c) => c + 1)
    if (reply?.txid) {
      setNewReplies((prev) =>
        prev.some((r) => r.txid === reply.txid) ? prev : [...prev, reply],
      )
    }
    onReplied?.(reply)
  }

  const removeNewReply = (txid) => {
    setNewReplies((prev) => prev.filter((r) => r.txid !== txid))
    setReplyCount((c) => Math.max(0, c - 1))
  }

  const handleQuoted = (quote) => {
    setShowQuote(false)
    setQuoteCount((c) => c + 1)
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
    if (e.target.closest('a, button, input, textarea, .inlinereply, .inlinequote, .quoted, .engage, .postmenu')) {
      return
    }
    // Stop here so a click on a nested reply opens ITS thread, not the ancestor's.
    e.stopPropagation()
    router.push(`/feed/${post.txid}`)
  }

  // In timelines that surface replies (Following feed, profile Replies tab), the
  // server attaches `post.parent` — a shallow preview of the post being replied
  // to — so we can show a "Replying to @X" context line that jumps to the thread.
  const parentId = post.parent
    ? String(post.parent.displayIdentity ?? post.parent.author_identity ?? '').trim()
    : ''
  const parentIsHandle = parentId.startsWith('@')

  // "Reposted by @X" context: the Following feed resurfaces a post at the moment
  // one of your followees reposted it (post.repostedBy). Show who did, linking to
  // their profile when it's a handle.
  const repostedBy = post.repostedBy ?? null
  const reposterId =
    typeof repostedBy?.identity === 'string' ? repostedBy.identity.trim() : ''
  const reposterIsHandle = reposterId.startsWith('@')

  return (
    <li className="post" onClick={openThread} style={{ cursor: 'pointer' }}>
      {repostedBy ? (
        <div className="repostedby">
          <span aria-hidden className="reposticon">🔁</span> Reposted by{' '}
          {reposterIsHandle ? (
            <Link
              href={`/${reposterId}`}
              className="repostedby-who"
              style={repostedBy.color ? { color: repostedBy.color } : undefined}
            >
              {reposterId}
            </Link>
          ) : (
            <span className="repostedby-who">{truncateAddress(reposterId)}</span>
          )}
        </div>
      ) : null}

      {post.parent ? (
        <Link href={`/feed/${post.parent.txid}`} className="replyingto">
          <span aria-hidden className="replyarrow">↳</span> Replying to{' '}
          <span
            className="replyingto-who"
            style={parentIsHandle && post.parent.displayColor ? { color: post.parent.displayColor } : undefined}
          >
            {post.parent.deleted
              ? 'a deleted post'
              : parentIsHandle
                ? parentId
                : truncateAddress(parentId)}
          </span>
        </Link>
      ) : null}

      <div className="postmeta">
        <Byline identity={post.displayIdentity ?? post.author_identity} color={post.displayColor} />
        <span aria-hidden className="dot">
          ·
        </span>
        <Link href={`/feed/${post.txid}`} className="time">
          {timeAgo(post.created_at)}
        </Link>
        {canManageAuthor ? (
          <PostMenu
            authorAccountId={post.author_account_id}
            authorLabel={authorLabel}
            initialFollowing={Boolean(post.followedByViewer)}
            onBlocked={onBlocked}
          />
        ) : null}
      </div>

      {shownBody ? (
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
      ) : null}

      {post.quoted_txid ? <QuotedEmbed post={post.quoted ?? null} /> : null}

      {!post.deleted ? (
        <ArticleCard card={post.articleCard ?? null} content={body} />
      ) : null}

      <div className="actions">
        <button type="button" onClick={() => setShowReply((s) => !s)} className="replybtn">
          💬 {replyCount > 0 ? replyCount : ''} Reply
        </button>
        {!post.deleted ? (
          <EngagementBar
            targetTxid={post.txid}
            likeCount={post.likeCount ?? 0}
            repostCount={post.repostCount ?? 0}
            quoteCount={quoteCount}
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

      {newReplies.length > 0 ? (
        <ul className="postreplies">
          {newReplies.map((reply) => (
            <FeedPost
              key={reply.txid}
              post={reply}
              viewerAccountId={viewerAccountId}
              onReplied={onReplied}
              onQuoted={onQuoted}
              onDeleted={removeNewReply}
              onBlocked={onBlocked}
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
}
