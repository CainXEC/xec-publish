'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import ComposeBox from '@/components/feed/ComposeBox'
import FeedPost from '@/components/feed/FeedPost'
import PostCopyLink from '@/components/feed/PostCopyLink'
import FeedTopbar from '@/components/feed/FeedTopbar'
import ActivityRail from '@/components/feed/ActivityRail'
import ArticleRail from '@/components/feed/ArticleRail'
import EngagementBar from '@/components/feed/EngagementBar'
import QuotedEmbed from '@/components/feed/QuotedEmbed'
import LinkedPostEmbed from '@/components/feed/LinkedPostEmbed'
import ArticleCard from '@/components/feed/ArticleCard'
import FeedBody from '@/components/feed/FeedBody'
import MintCard from '@/components/feed/MintCard'
import PollCard from '@/components/feed/PollCard'
import TranslateButton from '@/components/TranslateButton'
import TimeAgo from '@/components/feed/TimeAgo'
import { extractArticleSlug, stripArticleLink } from '@/lib/articleLinks'
import { extractFeedPostTxid, stripFeedPostLink } from '@/lib/contentLinks'
import { FEED_CSS } from '@/components/feed/feedTheme'

/** Strip both on-site link kinds (article + feed post) from displayed text — each
 *  is shown as its own embed/card, so the raw URL is redundant. */
function displayTextFor(content) {
  let text = extractArticleSlug(content) ? stripArticleLink(content) : content
  text = extractFeedPostTxid(text) ? stripFeedPostLink(text) : text
  return text
}

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
        {id.slice(1)}
      </Link>
    )
  }
  // A handle-less author still has a profile at /@<address> — link it too.
  return (
    <Link href={`/@${id.replace(/^ecash:/i, '')}`} className="addr" title={id}>
      {truncateAddress(id)}
    </Link>
  )
}

/**
 * One post in the ancestor chain above the focused post. Twitter-style: a left
 * rail with a node dot and a connecting line down to the next post. The whole
 * card navigates to that post's own thread.
 */
function AncestorNode({ post, top = false, onOpenThread = null }) {
  const router = useRouter()
  const textRef = useRef(null)
  const [expanded, setExpanded] = useState(false)
  const [clamped, setClamped] = useState(false)

  // The body is capped at 6 lines by CSS (.ttext). Detect when that cap is
  // actually hiding text so "Show more" only appears on a genuinely long parent
  // — letting you expand it in place instead of having to open its thread.
  useEffect(() => {
    const el = textRef.current
    if (!el || expanded) return
    setClamped(el.scrollHeight > el.clientHeight + 1)
  }, [expanded, post.content])

  const go = (e) => {
    if (e.target.closest('a, button')) return
    if (onOpenThread) {
      onOpenThread(post.txid)
      return
    }
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
          <ThreadByline identity={post.displayIdentity ?? post.author_identity} />
          <span aria-hidden className="dot">
            ·
          </span>
          <TimeAgo className="time" iso={post.created_at} />
        </div>
        <p ref={textRef} className={`ttext${expanded ? ' expanded' : ''}`}>
          {post.deleted ? (
            <span className="tombstone">This post was deleted.</span>
          ) : (
            <FeedBody text={displayTextFor(post.content)} />
          )}
        </p>
        {!post.deleted && (clamped || expanded) ? (
          <button
            type="button"
            className="showmore"
            onClick={() => setExpanded((s) => !s)}
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
        ) : null}
        {post.quoted_txid ? (
          <QuotedEmbed post={post.quoted ?? null} onOpenThread={onOpenThread} />
        ) : null}
        {!post.deleted && !post.quoted_txid && extractFeedPostTxid(post.content) ? (
          <LinkedPostEmbed
            linkedPost={post.linkedPost}
            content={post.content}
            onOpenThread={onOpenThread}
          />
        ) : null}
        {!post.deleted ? (
          <ArticleCard card={post.articleCard ?? null} content={post.content} />
        ) : null}
      </div>
    </div>
  )
}

export default function FeedThreadClient({
  initialPost,
  initialAncestors = [],
  initialReplies = [],
  viewerAccountId: initialViewerAccountId = null,
  isAuthor = false,
  // Reading-pane hosting: embedded=true renders just the thread (no page
  // chrome — the host owns the shell), and onOpenThread swaps the pane to
  // another thread instead of navigating (ancestors, replies, quote-jumps).
  embedded = false,
  onOpenThread = null,
}) {
  const router = useRouter()
  const [replies, setReplies] = useState(initialReplies)
  const [viewerAccountId, setViewerAccountId] = useState(initialViewerAccountId)
  const [rootDeleted, setRootDeleted] = useState(Boolean(initialPost?.deleted))
  const [deletingRoot, setDeletingRoot] = useState(false)
  const [showReply, setShowReply] = useState(false)
  const [showQuote, setShowQuote] = useState(false)
  const [translated, setTranslated] = useState(null)

  // Add a reply to the thread + close the box. Idempotent by txid: a pocket reply
  // shows optimistically the instant it broadcasts (its recording is handed to a
  // background confirm), so this fires once, but the dedup keeps it safe either way.
  const addReply = useCallback((reply) => {
    setShowReply(false)
    if (!reply?.txid) return
    if (reply.author_account_id) {
      setViewerAccountId((cur) => cur ?? reply.author_account_id)
    }
    setReplies((prev) => (prev.some((r) => r.txid === reply.txid) ? prev : [...prev, reply]))
  }, [])

  const removeReply = useCallback((txid) => {
    setReplies((prev) => prev.filter((r) => r.txid !== txid))
  }, [])

  // Blocking a replier drops all of their replies from the thread at once.
  const removeReplyAuthor = useCallback((accountId) => {
    if (!accountId) return
    setReplies((prev) => prev.filter((r) => r.author_account_id !== accountId))
  }, [])

  // A quote is a new top-level post; jump to its thread once it's recorded.
  const handleQuoted = useCallback(
    (quote) => {
      setShowQuote(false)
      if (!quote?.txid) return
      if (onOpenThread) onOpenThread(quote.txid)
      else router.push(`/feed/${quote.txid}`)
    },
    [router, onOpenThread],
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

  const content = (
    <>
        <div className="thread">
          {ancestors.map((a, i) => (
            <AncestorNode key={a.txid} post={a} top={i === 0} onOpenThread={onOpenThread} />
          ))}

          {/* Focused post: emphasized, X-style — pulled out of the rail indent so
              it spans full width (content aligned to the dot), with the dot, byline
              and timestamp all on one line above the body. */}
          <article className={`tnode focused${hasAncestors ? ' lineup' : ''}`}>
            <div className="tbody">
              <div className="tmeta">
                <span aria-hidden className="tdot" />
                <ThreadByline identity={post.displayIdentity ?? post.author_identity} />
                <span aria-hidden className="dot">
                  ·
                </span>
                <span className="time">{createdAt}</span>
                <span aria-hidden className="dot">
                  ·
                </span>
                <a
                  href={`https://explorer.e.cash/tx/${post.txid}`}
                  target="_blank"
                  rel="noreferrer"
                  className="onchain"
                >
                  on-chain
                </a>
                {!rootDeleted ? (
                  <span className="postactions">
                    <PostCopyLink txid={post.txid} />
                  </span>
                ) : null}
              </div>
              {rootDeleted ? (
                <p className="focusbody tombstone">This post was deleted.</p>
              ) : post.card_kind === 'handle_mint' ? (
                <MintCard post={post} />
              ) : (
                <>
                  {(() => {
                    const focusText = displayTextFor(post.content)
                    return focusText ? (
                      <p className="focusbody">
                        <FeedBody text={translated ?? focusText} />
                      </p>
                    ) : null
                  })()}
                  {post.card_kind === 'poll' ? <PollCard post={post} /> : null}
                  {post.quoted_txid ? (
                    <QuotedEmbed post={post.quoted ?? null} onOpenThread={onOpenThread} />
                  ) : null}
                  {!post.quoted_txid && extractFeedPostTxid(post.content) ? (
                    <LinkedPostEmbed
                      linkedPost={post.linkedPost}
                      content={post.content}
                      onOpenThread={onOpenThread}
                    />
                  ) : null}
                  <ArticleCard card={post.articleCard ?? null} content={post.content} />
                </>
              )}
              <div className="actions">
                <button
                  type="button"
                  onClick={() => setShowReply((s) => !s)}
                  className="replybtn"
                  aria-label="Reply"
                  title="Reply"
                >
                  💬 {replies.length > 0 ? replies.length : ''}
                </button>
                {!rootDeleted ? (
                  <EngagementBar
                    targetTxid={post.txid}
                    likeCount={post.likeCount ?? 0}
                    repostCount={post.repostCount ?? 0}
                    quoteCount={post.quoteCount ?? 0}
                    likedByViewer={Boolean(post.likedByViewer)}
                    repostedByViewer={Boolean(post.repostedByViewer)}
                    onQuote={() => setShowQuote((s) => !s)}
                  />
                ) : null}
                {!rootDeleted &&
                post.card_kind !== 'handle_mint' &&
                displayTextFor(post.content) ? (
                  <TranslateButton
                    kind="feed"
                    id={post.txid}
                    onTranslated={(d) => setTranslated(d.translated)}
                    onShowOriginal={() => setTranslated(null)}
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
                    allowOptimistic
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
                onBlocked={removeReplyAuthor}
                onOpenThread={onOpenThread ?? undefined}
              />
            ))}
          </ul>
        )}
    </>
  )

  // Reading-pane hosting: the host (home feed center column) already provides
  // the .pow-feed scope, topbar and column — render just the thread.
  if (embedded) {
    return <div className="threadpane">{content}</div>
  }

  // Desktop shell: the shared-post page is a top entry point for new visitors,
  // so it wears the same 3-column shell as the home feed — the front page
  // (≥1280px) on the left, the thread in the center column, the live activity
  // rail (≥1100px) on the right. Rails are in navigation mode (no inline panes
  // here), and their default breakpoints match the feed shell exactly. Below
  // 1100px the rails aren't grid items and this is the plain single column.
  return (
    <div className="pow-feed has-rail">
      <style>{FEED_CSS}</style>

      <FeedTopbar signedIn={viewerAccountId != null} isAuthor={isAuthor} />

      <div className="feed-cols">
        <aside className="feed-left" aria-label="The front page — long-form writing">
          <ArticleRail />
        </aside>
        <main className="wrap" style={{ paddingTop: '28px' }}>
          {content}
        </main>
        <aside className="feed-rail" aria-label="Live on-chain activity">
          <ActivityRail />
        </aside>
      </div>
    </div>
  )
}
