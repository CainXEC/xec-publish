'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import FeedBody from '@/components/feed/FeedBody'
import ComposeBox from '@/components/feed/ComposeBox'
import EngagementBar from '@/components/feed/EngagementBar'
import PostCopyLink from '@/components/feed/PostCopyLink'

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
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function CommentByline({ identity, color }) {
  const id = typeof identity === 'string' ? identity.trim() : ''
  if (id.startsWith('@')) {
    return (
      <Link href={`/@${id.slice(1)}`} className="byline" style={color ? { '--hc': color } : undefined}>
        {id.slice(1)}
      </Link>
    )
  }
  return (
    <Link href={`/@${id.replace(/^ecash:/i, '')}`} className="addr" title={id}>
      {truncateAddress(id)}
    </Link>
  )
}

/**
 * One comment in a forum thread's nested tree: byline · time, the full body (no
 * clamp), a compact action row (Reply + reactions), an inline reply composer, and
 * — recursively — its own child comments, indented. Reddit-style: the whole
 * discussion is visible at once, not drilled into like feed replies.
 */
function CommentNode({ comment, childrenByParent, viewerAccountId, onReplyAdded, onDeleted, depth }) {
  const [showReply, setShowReply] = useState(false)
  const kids = childrenByParent.get(comment.txid) ?? []
  const isOwn = !!viewerAccountId && comment.author_account_id === viewerAccountId

  return (
    <div className={`fcomment${depth > 0 ? ' nested' : ''}`}>
      <div className="fcomment-main">
        <div className="fcomment-meta">
          <CommentByline identity={comment.displayIdentity ?? comment.author_identity} color={comment.displayColor} />
          <span aria-hidden className="dot">·</span>
          <Link href={`/feed/${comment.txid}`} className="time" suppressHydrationWarning>
            {timeAgo(comment.created_at)}
          </Link>
          <span aria-hidden className="dot">·</span>
          <a
            href={`https://explorer.e.cash/tx/${comment.txid}`}
            target="_blank"
            rel="noreferrer"
            className="onchain"
          >
            on-chain
          </a>
          <PostCopyLink txid={comment.txid} />
        </div>

        {comment.deleted ? (
          <p className="fcomment-body tombstone">This comment was deleted.</p>
        ) : (
          <p className="fcomment-body">
            <FeedBody text={typeof comment.content === 'string' ? comment.content : ''} />
          </p>
        )}

        {!comment.deleted ? (
          <div className="actions">
            <button
              type="button"
              className="replybtn"
              onClick={() => setShowReply((s) => !s)}
              aria-label="Reply"
              title="Reply"
            >
              💬 Reply
            </button>
            <EngagementBar
              targetTxid={comment.txid}
              reactionCounts={comment.reactionCounts ?? {}}
              repostCount={comment.repostCount ?? 0}
              repostedByViewer={Boolean(comment.repostedByViewer)}
              canQuote={false}
              isOwnPost={isOwn}
            />
            {isOwn ? (
              <button
                type="button"
                className="delbtn"
                onClick={() => onDeleted(comment.txid)}
              >
                Delete
              </button>
            ) : null}
          </div>
        ) : null}

        {showReply ? (
          <div className="fcomment-reply">
            <ComposeBox
              action="reply"
              parentTxid={comment.txid}
              autoFocus
              compact
              placeholder="Add a comment…"
              allowOptimistic
              onPosted={(reply) => {
                setShowReply(false)
                onReplyAdded(reply)
              }}
              onCancel={() => setShowReply(false)}
            />
          </div>
        ) : null}
      </div>

      {kids.length > 0 ? (
        <div className="fcomment-children">
          {kids.map((child) => (
            <CommentNode
              key={child.txid}
              comment={child}
              childrenByParent={childrenByParent}
              viewerAccountId={viewerAccountId}
              onReplyAdded={onReplyAdded}
              onDeleted={onDeleted}
              depth={depth + 1}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

/**
 * The nested comment tree for a forum post. `replies` is the FLAT list of every
 * descendant (getFeedThread deep); we group by parent_txid and render the tree
 * rooted at `rootTxid`. A comment whose parent isn't in the set (its parent was
 * deleted/withheld) is promoted to a top-level comment so it isn't lost.
 */
export default function ForumComments({ replies, rootTxid, viewerAccountId, onReplyAdded, onDeleted }) {
  const { childrenByParent, roots } = useMemo(() => {
    const byTxid = new Set(replies.map((r) => r.txid))
    const map = new Map()
    const topRoots = []
    for (const r of replies) {
      const parent = r.parent_txid
      const isRootChild = parent === rootTxid || !parent || !byTxid.has(parent)
      if (isRootChild) {
        topRoots.push(r)
      } else {
        if (!map.has(parent)) map.set(parent, [])
        map.get(parent).push(r)
      }
    }
    // Keep chronological order within each parent.
    const cmp = (a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0)
    topRoots.sort(cmp)
    for (const arr of map.values()) arr.sort(cmp)
    return { childrenByParent: map, roots: topRoots }
  }, [replies, rootTxid])

  if (roots.length === 0) return null

  return (
    <div className="fcomments">
      {roots.map((c) => (
        <CommentNode
          key={c.txid}
          comment={c}
          childrenByParent={childrenByParent}
          viewerAccountId={viewerAccountId}
          onReplyAdded={onReplyAdded}
          onDeleted={onDeleted}
          depth={0}
        />
      ))}
    </div>
  )
}
