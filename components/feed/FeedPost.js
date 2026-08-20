'use client'

import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import ComposeBox from '@/components/feed/ComposeBox'
import EngagementBar from '@/components/feed/EngagementBar'
import QuotedEmbed from '@/components/feed/QuotedEmbed'
import LinkedPostEmbed from '@/components/feed/LinkedPostEmbed'
import ArticleCard from '@/components/feed/ArticleCard'
import ForumCard from '@/components/feed/ForumCard'
import MintCard from '@/components/feed/MintCard'
import PollCard from '@/components/feed/PollCard'
import FeedBody from '@/components/feed/FeedBody'
import PostCopyLink from '@/components/feed/PostCopyLink'
import TranslateButton from '@/components/TranslateButton'
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
import { extractForumSlug, stripForumLink } from '@/lib/forumLinks'
import { useConfirmDialog } from '@/components/ConfirmDialog'

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

function truncateAddress(addr) {
  const t = String(addr ?? '').trim()
  if (t.length <= 16) return t
  return `${t.slice(0, 10)}…${t.slice(-4)}`
}

// Long posts are clamped in the feed so one wall of text can't dominate the
// column. Clamp when the body runs past this many characters; the full text is
// always one tap away via "Show more" (or by opening the thread).
const FEED_CLAMP_CHARS = 280

// Context previews are held well under the body clamp on purpose: the post the
// reader came for has to stay the loudest thing in the row. The parent of a
// reply and the reply hanging under a post get a taste, not a copy.
const PARENT_CLAMP_CHARS = 140
const TOP_REPLY_CLAMP_CHARS = 120

/**
 * One feed post. The byline uses the poster's live identity (displayIdentity,
 * resolved from the account's current handle at load time; falls back to the
 * frozen author_identity for optimistic posts): "@handle" links to the profile;
 * a raw address is shown as truncated monospace text.
 */
function Byline({ identity, color, isAi = false }) {
  const id = typeof identity === 'string' ? identity.trim() : ''
  // AI-operated account (authors.is_ai) -> disclose right in the byline row.
  const aiBadge = isAi ? (
    <span className="aibadge" title="AI-operated account">
      [AI]
    </span>
  ) : null
  if (id.startsWith('@')) {
    const handle = id.slice(1)
    // A custom handle color (one of the theme swatches) overrides the default
    // neon byline; absent color keeps the CSS default.
    return (
      <>
        <Link href={`/@${handle}`} className="byline" style={color ? { '--hc': color } : undefined}>
          {handle}
        </Link>
        {aiBadge}
      </>
    )
  }
  // A raw address is a real profile too (/@<address> resolves to the account),
  // so link it like a handle. Strip the ecash: prefix for the pretty URL — the
  // resolver re-adds it.
  return (
    <>
      <Link href={`/@${id.replace(/^ecash:/i, '')}`} className="addr" title={id}>
        {truncateAddress(id)}
      </Link>
      {aiBadge}
    </>
  )
}

/**
 * Overflow "+" menu on someone else's post: the single home for the two
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
  const [confirmDialog, confirmDialogNode] = useConfirmDialog()

  useEffect(() => {
    if (!open) return
    const onDocClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  // The feed renders viewer-neutral posts from cache, then patches
  // followedByViewer in via /api/feed/viewer-state AFTER mount — so seeding
  // `following` from useState alone would freeze it at the mount-time value
  // (usually false) and keep showing a +. Re-sync when the prop actually flips.
  // Safe against optimistic toggles: the feed doesn't refetch viewer-state on a
  // follow, so initialFollowing doesn't change under an in-flight toggle.
  useEffect(() => {
    setFollowing(Boolean(initialFollowing))
  }, [initialFollowing])

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
    if (
      !(await confirmDialog(`Block${who}? You won't see each other's posts, and they can't reply to you.`, {
        confirmLabel: 'Block',
      }))
    ) {
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
      // Tell any live surface that renders a viewer-neutral, cached payload it
      // can't filter server-side (the ActivityRail firehose) to hide this account
      // immediately, without waiting for a navigation.
      window.dispatchEvent(
        new CustomEvent('pow:block-changed', { detail: { accountId: authorAccountId, blocked: true } }),
      )
      onBlocked?.(authorAccountId)
    } catch (e) {
      window.alert(e?.message || 'Failed to block')
      setBusyBlock(false)
    }
  }, [busyBlock, authorAccountId, authorLabel, onBlocked, confirmDialog])

  // Already following: show nothing at all. The feed isn't where you manage a
  // follow — no re-follow prompt, and unfollowing is a profile action.
  if (following) return null

  // Not following: the + opens the follow / block menu.
  return (
    <span className="postmenu" ref={rootRef}>
      <button
        type="button"
        className="menubtn"
        onClick={() => setOpen((s) => !s)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Follow or block"
      >
        +
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
            {busyFollow ? '…' : 'Follow'}
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
      {confirmDialogNode}
    </span>
  )
}

export default function FeedPost({ post, onReplied, onQuoted, viewerAccountId = null, onDeleted, onBlocked, mintVariant = 'full', onOpenThread = null, allowOptimisticQuote = false }) {
  const router = useRouter()
  const [translated, setTranslated] = useState(null)
  // Poll option labels from a translation ([{id,text}]); null = show originals.
  const [translatedOptions, setTranslatedOptions] = useState(null)
  const [showReply, setShowReply] = useState(false)
  const [showQuote, setShowQuote] = useState(false)
  const [replyCount, setReplyCount] = useState(post.replyCount ?? 0)
  const [quoteCount, setQuoteCount] = useState(post.quoteCount ?? 0)
  const [deleting, setDeleting] = useState(false)
  const [expanded, setExpanded] = useState(false)
  // Replies the viewer just posted, shown nested right here so they stay on the
  // feed instead of being navigated to the thread page.
  const [newReplies, setNewReplies] = useState([])
  const [confirmDialog, confirmDialogNode] = useConfirmDialog()

  const body = typeof post.content === 'string' ? post.content : ''
  // On-site links render as an embed/card that IS the link, so strip the raw URL
  // from the displayed text (an article link → ArticleCard; a feed-post link →
  // QuotedEmbed). Keep `body` intact for the card's slug/txid detection.
  let displayBody = extractArticleSlug(body) ? stripArticleLink(body) : body
  displayBody = extractFeedPostTxid(displayBody) ? stripFeedPostLink(displayBody) : displayBody
  displayBody = extractForumSlug(displayBody) ? stripForumLink(displayBody) : displayBody
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

  // Dedup by txid: a pocket-optimistic reply/quote shows the instant it broadcasts,
  // and its background confirm won't call back — but guarding by txid keeps the
  // count and list correct even if a handler ever fires twice.
  const seenReplyRef = useRef(new Set())
  const seenQuoteRef = useRef(new Set())

  const addReply = (reply) => {
    if (reply?.txid) {
      if (seenReplyRef.current.has(reply.txid)) return
      seenReplyRef.current.add(reply.txid)
      setNewReplies((prev) => [...prev, reply])
    }
    setReplyCount((c) => c + 1)
  }
  const handleReplied = (reply) => {
    setShowReply(false)
    addReply(reply)
    onReplied?.(reply)
  }

  const removeNewReply = (txid) => {
    seenReplyRef.current.delete(txid)
    setNewReplies((prev) => prev.filter((r) => r.txid !== txid))
    setReplyCount((c) => Math.max(0, c - 1))
  }

  const addQuote = (quote) => {
    if (quote?.txid) {
      if (seenQuoteRef.current.has(quote.txid)) return
      seenQuoteRef.current.add(quote.txid)
    }
    setQuoteCount((c) => c + 1)
    onQuoted?.(quote)
  }
  const handleQuoted = (quote) => {
    setShowQuote(false)
    addQuote(quote)
  }

  const handleDelete = async () => {
    if (deleting) return
    if (
      !(await confirmDialog('Delete this post? The on-chain record stays, but it will be removed from the feed.', {
        confirmLabel: 'Delete',
      }))
    ) {
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

  // Pin / unpin this post to the top of YOUR profile (one pin per account). The
  // server enforces ownership; a refresh re-fetches the profile with the new
  // order. `post.isPinned` is set only on the profile's pinned row, so it reads
  // "Unpin" there and "Pin" on every other own post.
  const [pinBusy, setPinBusy] = useState(false)
  // Pin state comes from the shared store (the viewer's ONE pinned txid), so the
  // button is correct wherever this post appears — feed, profile, thread — and
  // survives a refresh (`post.isPinned` alone was only set on the profile row, so
  // the feed showed "Pin" for a pinned post and flipped back on reload). Seed from
  // a server-provided isPinned for no flash on the profile, then /api/me hydrates.
  const [myPinned, setMyPinned] = useState(
    () => getMyPinnedTxid() ?? (isOwn && post.isPinned ? post.txid : null),
  )
  useEffect(() => {
    if (isOwn && post.isPinned) seedMyPinnedTxid(post.txid)
    void hydratePinned()
    return subscribePinned(setMyPinned)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const pinned = isOwn && !!post.txid && myPinned === post.txid
  const handlePin = async () => {
    if (pinBusy) return
    const next = !pinned
    const prev = getMyPinnedTxid()
    setPinBusy(true)
    setMyPinnedTxid(next ? post.txid : null) // optimistic + global (enforces one pin)
    try {
      const res = await fetch('/api/feed/pin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(next ? { txid: post.txid, pinned: true } : { pinned: false }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to update pin')
    } catch (e) {
      setMyPinnedTxid(prev) // revert to the prior pin on failure
      window.alert(e?.message || 'Could not update pin')
    } finally {
      setPinBusy(false)
    }
  }

  // Clicking anywhere on the post opens its thread, except on nested
  // interactive elements (the byline/timestamp links, the reply button, or the
  // inline reply composer).
  const openThread = (e) => {
    if (e.target.closest('a, button, input, textarea, .inlinereply, .inlinequote, .quoted, .engage, .postmenu')) {
      return
    }
    // Highlighting the post's text to copy it ends in a click — don't treat that
    // as a tap-to-open.
    if (isSelectingWithin(e.currentTarget)) return
    // Stop here so a click on a nested reply opens ITS thread, not the ancestor's.
    e.stopPropagation()
    // Host pages with a center reading pane (the home feed) open the thread
    // in place; everywhere else navigates to the thread page as before.
    if (onOpenThread) {
      onOpenThread(post.txid)
      return
    }
    router.push(`/feed/${post.txid}`)
  }

  // In timelines that surface replies (Following feed, profile Replies tab), the
  // server attaches `post.parent` — a shallow preview of the post being replied
  // to — so we can show a "Replying to @X" context line that jumps to the thread.
  const parentId = post.parent
    ? String(post.parent.displayIdentity ?? post.parent.author_identity ?? '').trim()
    : ''
  const parentIsHandle = parentId.startsWith('@')
  // The parent's own words, stripped of link-only text the same way a post body
  // is (a bare on-site URL renders as a card, never as raw text) and clamped —
  // this is context for the reply, not a second post.
  const parentPreviewText = (() => {
    if (!post.parent || post.parent.deleted) return ''
    const raw = typeof post.parent.content === 'string' ? post.parent.content : ''
    let t = extractArticleSlug(raw) ? stripArticleLink(raw) : raw
    t = extractFeedPostTxid(t) ? stripFeedPostLink(t) : t
    t = extractForumSlug(t) ? stripForumLink(t) : t
    t = t.trim()
    return t.length > PARENT_CLAMP_CHARS ? `${t.slice(0, PARENT_CLAMP_CHARS).trimEnd()}…` : t
  })()

  // "Reposted by @X" context: the Following feed resurfaces a post at the moment
  // one of your followees reposted it (post.repostedBy). Show who did, linking to
  // their profile when it's a handle.
  const repostedBy = post.repostedBy ?? null
  const reposterId =
    typeof repostedBy?.identity === 'string' ? repostedBy.identity.trim() : ''
  const reposterIsHandle = reposterId.startsWith('@')

  // A handle-mint card replaces the text body/embeds with the NFT card render —
  // except in timelines (mintVariant="compact"), where announcements ride as
  // quiet one-line text rows: the art lives on the profile gallery, the thread
  // page, and quote embeds. The row is still a real post (reply/quote/like all
  // work), so the buyer's "that's me!" quote flow is untouched.
  const isMintCard = post.card_kind === 'handle_mint' && !post.deleted
  const compactMint = isMintCard && mintVariant === 'compact'
  // A poll's question is the normal post body; the options/results card renders
  // right beneath it (see below). Polls have no compact variant.
  const isPoll = post.card_kind === 'poll' && !post.deleted

  // The best reply, hung under a post that has one (For You only — timelines
  // that carry reply rows of their own don't send it). Suppressed once the
  // viewer's own replies are showing inline, so the same conversation isn't
  // previewed and listed at the same time.
  const topReply = !post.deleted && newReplies.length === 0 ? (post.topReply ?? null) : null
  const topReplyText = (() => {
    if (!topReply) return ''
    const raw = typeof topReply.content === 'string' ? topReply.content : ''
    let t = extractArticleSlug(raw) ? stripArticleLink(raw) : raw
    t = extractFeedPostTxid(t) ? stripFeedPostLink(t) : t
    t = extractForumSlug(t) ? stripForumLink(t) : t
    t = t.trim()
    return t.length > TOP_REPLY_CLAMP_CHARS ? `${t.slice(0, TOP_REPLY_CLAMP_CHARS).trimEnd()}…` : t
  })()

  return (
    <li className={`post${compactMint ? ' mintline' : ''}`} onClick={openThread} style={{ cursor: 'pointer' }}>
      {pinned ? (
        <div className="pinnedtag"><span aria-hidden>📌</span> Pinned</div>
      ) : null}
      {repostedBy ? (
        <div className="repostedby">
          <span aria-hidden className="reposticon">🔁</span> Reposted by{' '}
          {reposterIsHandle ? (
            <Link
              href={`/${reposterId}`}
              className="repostedby-who"
              style={repostedBy.color ? { '--hc': repostedBy.color } : undefined}
            >
              {reposterId}
            </Link>
          ) : (
            <Link
              href={`/@${reposterId.replace(/^ecash:/i, '')}`}
              className="repostedby-who"
            >
              {truncateAddress(reposterId)}
            </Link>
          )}
        </div>
      ) : null}

      {/* A reply shown in a timeline (Following) carries the post it answers.
          The name alone isn't enough — "exactly this, and it's why the 6%
          matters" means nothing without what it's replying to — so the parent's
          own words come with it, clamped to a couple of lines. */}
      {post.parent ? (
        <Link href={`/feed/${post.parent.txid}`} className="replyingto">
          <span className="replyingto-head">
            <span aria-hidden className="replyarrow">↳</span> Replying to{' '}
            <span
              className="replyingto-who"
              style={parentIsHandle && post.parent.displayColor ? { '--hc': post.parent.displayColor } : undefined}
            >
              {post.parent.deleted
                ? 'a deleted post'
                : parentIsHandle
                  ? parentId
                  : truncateAddress(parentId)}
            </span>
          </span>
          {parentPreviewText ? (
            <span className="replyingto-body">{parentPreviewText}</span>
          ) : null}
        </Link>
      ) : null}

      <div className="postmeta">
        <Byline
          identity={post.displayIdentity ?? post.author_identity}
          color={post.displayColor}
          isAi={Boolean(post.displayIsAi)}
        />
        <span aria-hidden className="dot">
          ·
        </span>
        {/* Relative time is Date.now()-based, so SSR and the (slightly later)
            client hydration can disagree near a boundary ("59m" -> "1h"). That
            mismatch was throwing a hydration error and forcing a full client
            re-render (which also surfaced the head <script> warning). Timestamps
            are exactly what suppressHydrationWarning is for. */}
        <Link href={`/feed/${post.txid}`} className="time" suppressHydrationWarning>
          {timeAgo(post.created_at)}
        </Link>
        <span className="postactions">
          {!post.deleted ? <PostCopyLink txid={post.txid} /> : null}
          {canManageAuthor ? (
            <PostMenu
              authorAccountId={post.author_account_id}
              authorLabel={authorLabel}
              initialFollowing={Boolean(post.followedByViewer)}
              onBlocked={onBlocked}
            />
          ) : null}
        </span>
      </div>

      {isMintCard && !compactMint ? (
        <MintCard post={post} />
      ) : (
        <>
          {shownBody ? (
            <p className="body">
              <FeedBody text={translated ?? shownBody} />
              {isLong && !translated ? (
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

          {isPoll ? <PollCard post={post} optionOverrides={translatedOptions} /> : null}

          {post.quoted_txid ? (
            <QuotedEmbed post={post.quoted ?? null} onOpenThread={onOpenThread ?? undefined} />
          ) : null}

          {/* A pasted on-site feed-post link (not a native quote) renders the target
              as a quoted embed below — "as if you'd quoted it". Server posts carry a
              resolved post.linkedPost; a just-posted one hydrates from the txid. */}
          {!post.deleted && !post.quoted_txid && extractFeedPostTxid(body) ? (
            <LinkedPostEmbed
              linkedPost={post.linkedPost}
              content={body}
              onOpenThread={onOpenThread ?? undefined}
            />
          ) : null}

          {!post.deleted ? (
            <ArticleCard card={post.articleCard ?? null} content={body} />
          ) : null}

          {!post.deleted ? (
            <ForumCard card={post.forumCard ?? null} content={body} />
          ) : null}
        </>
      )}

      {/* Conversation teaser: For You carries no reply rows, so a replied-to post
          brings its best reply along (highest-paid, by someone other than the
          author — see attachTopReply). No extra click target: the whole row
          already opens this post's thread, which is exactly where the reply is. */}
      {topReply && topReplyText ? (
        <div className="toprep">
          <span aria-hidden className="toprep-arrow">↳</span>
          <Byline
            identity={topReply.displayIdentity ?? topReply.author_identity}
            color={topReply.displayColor}
            isAi={Boolean(topReply.displayIsAi)}
          />
          <span className="toprep-body">{topReplyText}</span>
        </div>
      ) : null}

      <div className="actions">
        <button
          type="button"
          onClick={() => setShowReply((s) => !s)}
          className="replybtn"
          aria-label="Reply"
          title="Reply"
        >
          💬 {replyCount > 0 ? replyCount : ''}
        </button>
        {!post.deleted ? (
          <EngagementBar
            targetTxid={post.txid}
            reactionCounts={post.reactionCounts ?? {}}
            repostCount={post.repostCount ?? 0}
            quoteCount={quoteCount}
            repostedByViewer={Boolean(post.repostedByViewer)}
            isOwnPost={isOwn}
            onQuote={() => setShowQuote((s) => !s)}
          />
        ) : null}
        {!post.deleted && body ? (
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
        {isOwn ? (
          <button type="button" onClick={handlePin} disabled={pinBusy} className="pinbtn">
            {pinBusy ? '…' : pinned ? 'Unpin' : 'Pin'}
          </button>
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
            allowOptimistic
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
            allowOptimistic={allowOptimisticQuote}
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
      {confirmDialogNode}
    </li>
  )
}

/**
 * ONE digest row summarizing the mints in a page's time span (see
 * buildMintEntries in lib/getFeed.js): names a few handles, then collapses the
 * rest into "and N others" — "@X, @Y, @Z and 61 others minted handles". The
 * named handles are a subset of the count, so a named handle is never also in
 * "others"; and page spans are disjoint, so each mint appears in exactly one
 * digest — no double-counting.
 */
export function MintDigestRow({ digest }) {
  const named = (digest?.named ?? []).filter((h) => h?.handle)
  const others = Math.max(0, Number(digest?.others) || 0)
  const total = named.length + others
  if (total === 0) return null

  // Every mint is minted BY the platform's official account, so the digest is
  // attributed to @proofofwriting (clickable → its profile). The minted handles
  // remain their own links. Reads "@proofofwriting minted @a, @b and N others".
  return (
    <li className="post mintdigest">
      <span aria-hidden className="mintdigest-icon">🖊️</span>
      <span className="mintdigest-text">
        <Link href="/@proofofwriting" className="mintdigest-actor">
          @proofofwriting
        </Link>{' '}
        minted{' '}
        {named.length > 0 ? (
          <>
            {named.map((h, i) => (
              <Fragment key={h.txid ?? h.handle}>
                {i > 0 ? (others === 0 && i === named.length - 1 ? ' and ' : ', ') : ''}
                <Link href={`/@${h.handle}`} className="mention">
                  @{h.handle}
                </Link>
              </Fragment>
            ))}
            {others > 0 ? (
              <span className="mintdigest-more">
                {' and '}
                {others.toLocaleString('en-US')} other{others === 1 ? '' : 's'}
              </span>
            ) : null}
          </>
        ) : (
          <span className="mintdigest-more">
            {others.toLocaleString('en-US')} handle{others === 1 ? '' : 's'}
          </span>
        )}
      </span>
      <span aria-hidden className="dot">
        ·
      </span>
      <span className="time" suppressHydrationWarning>{timeAgo(digest?.created_at)}</span>
    </li>
  )
}
