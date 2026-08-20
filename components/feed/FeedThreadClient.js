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
import { getTranslation } from '@/lib/translateStore'
import { isSelectingWithin } from '@/lib/selectionGuard'
import {
  getMyPinnedTxid,
  setMyPinnedTxid,
  seedMyPinnedTxid,
  subscribePinned,
  hydratePinned,
} from '@/lib/pinnedStore'
import { extractArticleSlug, stripArticleLink } from '@/lib/articleLinks'
import { extractFeedPostTxid, stripFeedPostLink } from '@/lib/contentLinks'
import { useConfirmDialog } from '@/components/ConfirmDialog'
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
  // Pinned locale + UTC so SSR and client hydrate identical text (#418).
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

function ThreadByline({ identity, color = null }) {
  const id = typeof identity === 'string' ? identity.trim() : ''
  if (id.startsWith('@')) {
    // Carry the holder's chosen handle color (the same `--hc` var FeedPost's
    // Byline uses); without it the byline falls back to the default neon, which
    // is why the color used to "revert to green" on the focused/ancestor posts.
    return (
      <Link
        href={`/@${id.slice(1)}`}
        className="byline"
        style={color ? { '--hc': color } : undefined}
      >
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

  // Keep a translated parent translated: if the viewer has translated this post,
  // show that translation here too. Ancestors used to always render the original,
  // so opening a reply reverted a translated parent to its source language. Same
  // in-memory store the focused post and feed rows use, re-applied on mount.
  const [tr, setTr] = useState(null)
  useEffect(() => {
    setTr(getTranslation('feed', post.txid)?.translated ?? null)
  }, [post.txid])

  // The body is capped at 6 lines by CSS (.ttext). Detect when that cap is
  // actually hiding text so "Show more" only appears on a genuinely long parent
  // — letting you expand it in place instead of having to open its thread.
  useEffect(() => {
    const el = textRef.current
    if (!el || expanded) return
    setClamped(el.scrollHeight > el.clientHeight + 1)
  }, [expanded, post.content, tr])

  const go = (e) => {
    if (e.target.closest('a, button')) return
    // Highlighting the parent's text to copy it ends in a click — not a tap.
    if (isSelectingWithin(e.currentTarget)) return
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
          <ThreadByline
            identity={post.displayIdentity ?? post.author_identity}
            color={post.displayColor}
          />
          <span aria-hidden className="dot">
            ·
          </span>
          {/* Relative time is Date.now()-based → SSR/hydration can disagree at a
              boundary; suppress that mismatch (same as FeedPost). */}
          <span className="time" suppressHydrationWarning>{timeAgo(post.created_at)}</span>
        </div>
        <p ref={textRef} className={`ttext${expanded ? ' expanded' : ''}`}>
          {post.deleted ? (
            <span className="tombstone">This post was deleted.</span>
          ) : (
            <FeedBody text={tr ?? displayTextFor(post.content)} />
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
  const [confirmDialog, confirmDialogNode] = useConfirmDialog()
  // Open a reply-less thread with the composer already up: "No replies yet." was a
  // dead end, and being first to reply is the whole reason you opened it. Skipped
  // for a deleted root (nothing to reply to). The pane keys this component by txid,
  // so swapping threads re-evaluates it.
  const [showReply, setShowReply] = useState(
    initialReplies.length === 0 && !initialPost?.deleted,
  )
  // Auto-opening must NOT steal focus — on mobile that would throw the keyboard up
  // over a post you came to read. Only an explicit tap on 💬 focuses the box.
  const [replyFocus, setReplyFocus] = useState(false)
  const [showQuote, setShowQuote] = useState(false)
  const [translated, setTranslated] = useState(null)
  // Poll option labels from a translation ([{id,text}]); null = show originals.
  const [translatedOptions, setTranslatedOptions] = useState(null)

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

  // A quote is a new top-level post. In a reading pane (onOpenThread set), swap
  // the pane to its thread. On the STANDALONE thread page there's no pane to
  // swap — land back on the main feed (where the fresh quote sorts to the top)
  // rather than the quote's own bare permalink page, which read as "lost" the
  // post you were just viewing for a page with nothing else on it.
  const handleQuoted = useCallback(
    (quote) => {
      setShowQuote(false)
      if (!quote?.txid) return
      if (onOpenThread) onOpenThread(quote.txid)
      else router.push('/')
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
    if (
      !(await confirmDialog('Delete this post? The on-chain record stays, but it will be removed from the feed.', {
        confirmLabel: 'Delete',
      }))
    ) {
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

  // Pin / unpin this post to the top of your profile, right from its own page.
  // Optimistic so the button flips instantly (mirrors FeedPost).
  const [pinBusy, setPinBusy] = useState(false)
  // Shared pin store (see FeedPost / lib/pinnedStore) — one source of truth for
  // the viewer's pinned txid, so the button is right here too and survives reload.
  const [myPinned, setMyPinned] = useState(
    () => getMyPinnedTxid() ?? (isOwnRoot && post?.isPinned ? post.txid : null),
  )
  useEffect(() => {
    if (isOwnRoot && post?.isPinned) seedMyPinnedTxid(post.txid)
    void hydratePinned()
    return subscribePinned(setMyPinned)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const pinned = isOwnRoot && !!post?.txid && myPinned === post.txid
  const handlePinRoot = async () => {
    if (pinBusy) return
    const next = !pinned
    const prev = getMyPinnedTxid()
    setPinBusy(true)
    setMyPinnedTxid(next ? post.txid : null)
    try {
      const res = await fetch('/api/feed/pin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(next ? { txid: post.txid, pinned: true } : { pinned: false }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to update pin')
    } catch (e) {
      setMyPinnedTxid(prev)
      window.alert(e?.message || 'Could not update pin')
    } finally {
      setPinBusy(false)
    }
  }

  // Pinned locale + UTC (with a zone label) so SSR and client hydrate
  // identical text (#418).
  const createdAt = post?.created_at
    ? new Date(post.created_at).toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'UTC',
        timeZoneName: 'short',
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
                <ThreadByline
                  identity={post.displayIdentity ?? post.author_identity}
                  color={post.displayColor}
                />
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
                  {post.title ? <h1 className="focustitle">{post.title}</h1> : null}
                  {(() => {
                    const focusText = displayTextFor(post.content)
                    return focusText ? (
                      <p className="focusbody">
                        <FeedBody text={translated ?? focusText} />
                      </p>
                    ) : null
                  })()}
                  {post.card_kind === 'poll' ? (
                    <PollCard post={post} optionOverrides={translatedOptions} />
                  ) : null}
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
                  onClick={() => {
                    setShowReply((s) => !s)
                    setReplyFocus(true) // an explicit tap puts the caret in the box
                  }}
                  className="replybtn"
                  aria-label="Reply"
                  title="Reply"
                >
                  💬 {replies.length > 0 ? replies.length : ''}
                </button>
                {!rootDeleted ? (
                  <EngagementBar
                    targetTxid={post.txid}
                    reactionCounts={post.reactionCounts ?? {}}
                    repostCount={post.repostCount ?? 0}
                    quoteCount={post.quoteCount ?? 0}
                    repostedByViewer={Boolean(post.repostedByViewer)}
                    isOwnPost={isOwnRoot}
                    onQuote={() => setShowQuote((s) => !s)}
                  />
                ) : null}
                {!rootDeleted &&
                post.card_kind !== 'handle_mint' &&
                displayTextFor(post.content) ? (
                  <TranslateButton
                    kind="feed"
                    id={post.txid}
                    onTranslated={(d) => {
                      setTranslated(d.translated)
                      setTranslatedOptions(Array.isArray(d.options) ? d.options : null)
                    }}
                    onShowOriginal={() => {
                      setTranslated(null)
                      setTranslatedOptions(null)
                    }}
                  />
                ) : null}
                {isOwnRoot ? (
                  <button
                    type="button"
                    onClick={handlePinRoot}
                    disabled={pinBusy}
                    className="pinbtn"
                  >
                    {pinBusy ? '…' : pinned ? 'Unpin' : 'Pin'}
                  </button>
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
                    autoFocus={replyFocus}
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
          // The open composer above IS the call to action — "No replies yet."
          // under it just restates the "0 replies" heading. Show it only when the
          // reader has closed the box.
          showReply ? null : <p className="empty">No replies yet.</p>
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
      {confirmDialogNode}
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
