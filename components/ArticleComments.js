'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { priceFeedPost, FEED_MAX_CHARS } from '@/lib/feedPricing'
import { tokenizeContent } from '@/lib/contentLinks'
import TranslateButton from '@/components/TranslateButton'
import CommentLike from '@/components/feed/CommentLike'
import EmojiPicker from '@/components/EmojiPicker'
import { prewarmPaymentWatch } from '@/lib/ecash/watchPaymentAddress'
import { pollUntil } from '@/lib/ecash/pollUntil'
// Pocket-aware gateway: identical contract to the cashtabPay trio. Pocket
// eligible → local sign + instant broadcast (r.txid feeds the confirm poll);
// otherwise the exact extension/web-tab behavior this file always had.
import { beginPayment, completePayment, abortPayment } from '@/lib/pocket/payGateway'
import { getPocketSnapshot } from '@/lib/pocket/store'
import { confirmCommentInBackground } from '@/lib/comments/confirmComment'

// =============================================================================
//  ArticleComments — paid, threaded comments on an article.
//  Comments cost like a feed post (100 XEC floor, 1 XEC/char). A top-level
//  comment pays the ARTICLE author 94/6; a reply pays the author of whatever it
//  answers, 94/6. Threads are flat, feed-style — a reply carries a "Replying to
//  @X" line, no indentation — and you can reply to anything (parent_id links,
//  so legacy free comments are replyable too).
//
//  Payment mirrors the feed composer: type → /api/comments/prepare (BIP21 +
//  Cashtab link) → pay in Cashtab → poll /api/comments/confirm until the
//  on-chain payment is detected and the comment is recorded.
// =============================================================================

// A handle (@x, ≤16 chars) shows in full; a raw eCash address is truncated so a
// long address can't overflow the comment card / "Replying to" line on mobile.
function truncateIdentity(id) {
  const t = String(id ?? '').trim()
  if (t.length <= 16) return t
  return `${t.slice(0, 10)}…${t.slice(-4)}`
}

// Render comment text with same-site URLs (proofofwriting.com) as clickable
// internal links; external URLs stay inert plain text. Text runs are emitted as
// raw nodes so `.commentbody`'s white-space: pre-wrap keeps newlines intact.
function CommentBody({ text }) {
  const tokens = tokenizeContent(text)
  return tokens.map((t, i) => {
    // @handle → the mentioned profile (same convention as the feed). Tagging
    // someone here also pings them (see recordCommentMentionNotifications).
    if (t.type === 'mention') {
      return (
        <Link key={i} href={`/@${t.handle}`} className="mention">
          {t.value}
        </Link>
      )
    }
    if (t.type === 'link') {
      return (
        <Link key={i} href={t.href}>
          {t.value}
        </Link>
      )
    }
    return <Fragment key={i}>{t.value}</Fragment>
  })
}

// A comment byline links to the commenter's profile, same as everywhere else:
// "@handle" → /@handle, a raw eCash address → /@<address> (the profile route
// resolves either to the account). Placeholder bylines (Anonymous, a [deleted]
// tombstone) aren't linkable.
function profileHref(identity) {
  const id = String(identity ?? '').trim()
  if (!id || id === 'Anonymous' || id === '[deleted]') return null
  if (id.startsWith('@')) return `/@${encodeURIComponent(id.slice(1))}`
  const bare = id.toLowerCase().replace(/^ecash:/, '')
  return /^[a-z0-9]{42}$/.test(bare) ? `/@${bare}` : null
}

function formatCommentDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Depth-first thread order: each comment is immediately followed by its
 *  descendants (siblings in chronological order), so the flat list reads in
 *  conversation order without any indentation. Threaded by parent_id (every
 *  comment has an id), so legacy free comments thread the same as paid ones.
 *  A comment whose parent isn't in the set is treated as a root. */
function buildThreadOrder(comments) {
  const byId = new Map()
  for (const c of comments) byId.set(c.id, c)
  const childrenOf = new Map()
  const roots = []
  const byCreated = (a, b) => new Date(a.created_at) - new Date(b.created_at)
  for (const c of comments) {
    const parent = c.parent_id && byId.has(c.parent_id) ? c.parent_id : null
    if (parent) {
      if (!childrenOf.has(parent)) childrenOf.set(parent, [])
      childrenOf.get(parent).push(c)
    } else {
      roots.push(c)
    }
  }
  // Collect a subtree in DFS order, but DROP a deleted comment that has no
  // visible descendants — a deleted leaf just disappears. A deleted comment
  // WITH replies stays (as an anonymized tombstone) so its replies keep their
  // context. Collapse is recursive: if all of a deleted node's children also
  // vanish, the node vanishes too.
  const collect = (node) => {
    const kids = (childrenOf.get(node.id) || []).slice().sort(byCreated)
    const below = kids.flatMap(collect)
    if (node.deleted && below.length === 0) return []
    return [node, ...below]
  }
  return roots.slice().sort(byCreated).flatMap(collect)
}

/** Compose + pay a top-level comment (parentId null) or a reply.
 *  onPosted    — show + close (the optimistic broadcast and the Cashtab confirm).
 *  onConfirmed — swap the optimistic row for the recorded one (real DB id), used
 *                by the background confirm; must NOT close the composer. */
function CommentComposer({ postId, parentId = null, autoFocus = false, onPosted, onConfirmed, onCancel }) {
  const [content, setContent] = useState('')
  const [phase, setPhase] = useState('compose') // 'compose' | 'paying'
  const [intent, setIntent] = useState(null)
  const [notice, setNotice] = useState('')
  const [txidInput, setTxidInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // True when the click resolved to a pocket payment — drives the compact
  // "Posting…" screen and the optimistic dismiss (vs the Cashtab wait screen).
  const [payViaPocket, setPayViaPocket] = useState(false)
  const textareaRef = useRef(null)

  const priced = priceFeedPost(content)
  const chars = priced.chars
  const over = chars > FEED_MAX_CHARS
  const canSubmit = priced.ok && !submitting
  const isReply = Boolean(parentId)

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus()
  }, [autoFocus])

  // Insert an emoji at the caret (replacing any selection), caret after it —
  // same feel as the feed composer.
  const insertEmoji = useCallback((emoji) => {
    const el = textareaRef.current
    setContent((prev) => {
      const start = el?.selectionStart ?? prev.length
      const end = el?.selectionEnd ?? prev.length
      const next = prev.slice(0, start) + emoji + prev.slice(end)
      if (el) {
        const pos = start + emoji.length
        requestAnimationFrame(() => {
          el.focus()
          try { el.setSelectionRange(pos, pos) } catch { /* noop */ }
        })
      }
      return next
    })
  }, [])

  const resetToCompose = useCallback(() => {
    setPhase('compose')
    setIntent(null)
    setNotice('')
    setTxidInput('')
    setPayViaPocket(false)
  }, [])

  const handlePosted = useCallback(
    (comment) => {
      onPosted?.(comment)
      setContent('')
      resetToCompose()
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('sessionChanged'))
      }
    },
    [onPosted, resetToCompose],
  )

  const startPayment = useCallback(async () => {
    if (!priced.ok) return
    setSubmitting(true)
    setNotice('')
    prewarmPaymentWatch()
    // Pocket-vs-Cashtab decided AT the click (the client prices the comment
    // itself, so eligibility is synchronous). Pocket opens nothing.
    const handle = beginPayment({ kind: 'comment', amountXec: priced.costXec })
    setPayViaPocket(handle.mode === 'pocket')
    try {
      const res = await fetch('/api/comments/prepare', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ postId, content, parentId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) {
        abortPayment(handle)
        setPayViaPocket(false)
        setNotice(data.error || 'Could not start the payment. Try again.')
        return
      }
      void completePayment(handle, {
        bip21: data.bip21Url,
        cashtabUrl: data.cashtabUrl,
      }).then((r) => {
        if (r.ok && r.txid) {
          // A txid = proof the payment broadcast: the Pocket always returns one, and
          // the Cashtab EXTENSION returns one the instant you approve — both show the
          // comment NOW and dismiss the composer. The web tab has no txid, so it stays
          // on the confirm poll. Recording is handed to a background confirm that swaps
          // this optimistic row for the recorded one (its real DB id lets replies
          // thread correctly); that swap also corrects the byline if it wasn't known.
          const snap = getPocketSnapshot()
          confirmCommentInBackground({
            postId,
            content,
            parentId,
            txid: r.txid,
            preparedAt: data.preparedAt,
            payAddress: data.payAddress,
            onConfirmed: onConfirmed || onPosted,
          })
          handlePosted({
            id: `optimistic-${r.txid}`,
            txid: r.txid,
            parent_id: parentId ?? null,
            parent_txid: null,
            content,
            author_account_id: snap.accountId ?? null,
            author_identity: snap.identity ?? null,
            payer_address: snap.primaryAddress ?? null,
            color: snap.handleColor ?? null,
            created_at: new Date().toISOString(),
            deleted: false,
            optimistic: true,
          })
        } else if (!r.ok && r.reason === 'denied') {
          resetToCompose()
          setNotice('Payment cancelled — your draft is safe.')
        } else if (!r.ok && r.reason === 'pocket_error') {
          setPayViaPocket(false)
          setNotice(r.message || 'Pocket couldn’t send — use the Cashtab link below.')
        }
      })
      setIntent(data)
      setPhase('paying')
    } catch {
      abortPayment(handle)
      setPayViaPocket(false)
      setNotice('Network hiccup — try again.')
    } finally {
      setSubmitting(false)
    }
  }, [content, parentId, postId, priced.ok, priced.costXec, resetToCompose, handlePosted, onPosted, onConfirmed])

  // Poll for the on-chain payment while paying via Cashtab. (The pocket path is
  // optimistic — it hands recording to confirmCommentInBackground instead.) The
  // shared pollUntil owns the interval + ws nudge and adds a 429 backoff + a
  // lifetime cap this loop previously lacked, so a stuck comment payment can't
  // hammer the rate-limited confirm route.
  useEffect(() => {
    if (phase !== 'paying' || !intent || payViaPocket) return undefined
    return pollUntil(
      async (wsTxid) => {
        // A pocket-paid comment knows its txid up front; the ws nudge supplies it
        // for the web-tab path — either way a single-tx verify.
        const knownTxid = wsTxid ?? intent.pocketTxid
        const res = await fetch('/api/comments/confirm', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            postId,
            content,
            parentId,
            since: intent.preparedAt,
            ...(knownTxid ? { txid: knownTxid } : {}),
          }),
        })
        if (res.status === 429) return { backoff: true }
        const data = await res.json().catch(() => ({}))
        if (data.status === 'posted' && data.comment) {
          handlePosted(data.comment)
          return { done: true }
        }
        if (!res.ok) setNotice(data.error || 'Verification failed.')
        return undefined
      },
      { onWsAddress: intent.payAddress, wsThreadsTxid: true, maxLifetimeMs: 120_000 },
    )
  }, [phase, intent, payViaPocket, content, parentId, postId, handlePosted])

  const verifyManual = useCallback(async () => {
    const t = txidInput.trim()
    if (!/^[0-9a-f]{64}$/i.test(t)) {
      setNotice('Enter a valid 64-character transaction ID.')
      return
    }
    setNotice('Checking that transaction…')
    try {
      const res = await fetch('/api/comments/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ postId, content, parentId, txid: t }),
      })
      const data = await res.json().catch(() => ({}))
      if (data.status === 'posted' && data.comment) {
        handlePosted(data.comment)
      } else if (data.status === 'awaiting_payment') {
        setNotice("That transaction doesn't match this comment yet.")
      } else {
        setNotice(data.error || 'Could not verify that transaction.')
      }
    } catch {
      setNotice('Network hiccup — try again.')
    }
  }, [txidInput, content, parentId, postId, handlePosted])

  const noun = isReply ? 'reply' : 'comment'

  // Pocket path: the payment is already broadcasting locally — a compact "Posting…"
  // beat, then the optimistic dismiss lands the comment (~instant).
  if (phase === 'paying' && payViaPocket) {
    return (
      <div className={`commentpay${isReply ? ' commentpay-reply' : ''}`}>
        <div className="commentpay-poll">
          <span className="spinner" aria-hidden />
          <span>Posting your {noun}…</span>
        </div>
      </div>
    )
  }

  if (phase === 'paying' && intent) {
    return (
      <div className={`commentpay${isReply ? ' commentpay-reply' : ''}`}>
        <p className="commentpay-head">
          Cashtab opened for <strong>{intent.amountXec} XEC</strong>. Confirm the {noun} there.
        </p>
        <div className="commentpay-poll">
          <span className="spinner" aria-hidden />
          <span>Waiting for your payment…</span>
        </div>
        <details className="commentmanual">
          <summary>Cashtab didn&apos;t open, or already paid?</summary>
          <div style={{ textAlign: 'center', margin: '10px 0 0' }}>
            <a href={intent.cashtabUrl} target="_blank" rel="noreferrer" className="commentghost">
              Open in Cashtab
            </a>
          </div>
          <div className="commentmanualrow">
            <input
              value={txidInput}
              onChange={(e) => setTxidInput(e.target.value)}
              placeholder="Paste the transaction ID"
              spellCheck={false}
            />
            <button type="button" onClick={() => void verifyManual()} className="postcomment-btn">
              Verify
            </button>
          </div>
        </details>
        {notice ? <p className="commenterr">{notice}</p> : null}
        <div style={{ marginTop: '12px' }}>
          <button type="button" onClick={resetToCompose} className="commentlink">
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={`commentform${isReply ? ' commentform-reply' : ''}`}>
      {!isReply ? (
        <label htmlFor="new-comment" className="commentlabel">
          Add a comment
        </label>
      ) : null}
      <textarea
        ref={textareaRef}
        id={isReply ? undefined : 'new-comment'}
        rows={isReply ? 2 : 4}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        className="commentarea"
        placeholder={isReply ? 'Post your reply…' : 'Share your thoughts…'}
        // Tells the mobile bottom nav bar to get out of the way while typing
        // (see BottomNav.js) — same fix as the feed's ComposeBox: the fixed
        // bar has no awareness of the on-screen keyboard and can end up
        // sitting on top of this composer's own Pay button.
        onFocus={() => window.dispatchEvent(new Event('pow:composer-focus'))}
        onBlur={() => window.dispatchEvent(new Event('pow:composer-blur'))}
      />
      <div className="commentbar">
        <div className="commentbar-left">
          <EmojiPicker onPick={insertEmoji} />
          <span className={`charcount${over ? ' over' : ''}`}>
            {chars}/{FEED_MAX_CHARS}
          </span>
        </div>
        <div className="commentbar-btns">
          {isReply && onCancel ? (
            <button type="button" onClick={onCancel} className="commentghost">
              Cancel
            </button>
          ) : null}
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => void startPayment()}
            className="postcomment-btn"
          >
            {priced.ok ? `Pay · ${priced.costXec} XEC` : isReply ? 'Reply' : 'Comment'}
          </button>
        </div>
      </div>
      {notice ? <p className="commenterr">{notice}</p> : null}
    </div>
  )
}

export default function ArticleComments({ postId, canComment, me, isAuthorSession, onChanged }) {
  const [comments, setComments] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [replyingTo, setReplyingTo] = useState(null) // parent txid, or null
  const [deletingId, setDeletingId] = useState(null)
  const [actionError, setActionError] = useState(null)
  const [translations, setTranslations] = useState({}) // { [commentId]: translatedText }

  const fetchComments = useCallback(async () => {
    if (!postId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/comments/${encodeURIComponent(postId)}`, { cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error || 'Could not load comments.')
        setComments([])
        return
      }
      setComments(Array.isArray(data?.comments) ? data.comments : [])
    } catch {
      setError('Could not load comments.')
      setComments([])
    } finally {
      setLoading(false)
    }
  }, [postId])

  useEffect(() => {
    if (postId && canComment) void fetchComments()
  }, [postId, canComment, fetchComments])

  // Upsert by txid: append a new comment, OR replace an existing row with the
  // same txid. The replace is what lets a pocket comment show OPTIMISTICALLY (a
  // temp `optimistic-<txid>` id) and then, when its background confirm lands, take
  // on the REAL DB id — so replies to it thread correctly. Does NOT close any
  // composer, so a confirm landing can't yank away an unrelated open reply box.
  const upsertComment = useCallback(
    (comment) => {
      setComments((prev) => {
        if (comment.txid && prev.some((c) => c.txid === comment.txid)) {
          // Merge (not replace): the confirm row corrects the byline/id but
          // carries no `color`/`isAi`, so keep the optimistic ones through the swap.
          return prev.map((c) => (c.txid === comment.txid ? { ...c, ...comment, deleted: false } : c))
        }
        return [...prev, { ...comment, deleted: false }]
      })
      onChanged?.()
    },
    [onChanged],
  )

  // Initial post (optimistic broadcast or Cashtab confirm): show it AND close the
  // composer that made it.
  const handlePosted = useCallback(
    (comment) => {
      upsertComment(comment)
      setReplyingTo(null)
    },
    [upsertComment],
  )

  const handleDelete = useCallback(
    async (commentId) => {
      if (!postId || !commentId) return
      if (!window.confirm('Are you sure you want to delete this comment?')) return
      setDeletingId(commentId)
      setActionError(null)
      try {
        const res = await fetch(`/api/comments/${encodeURIComponent(postId)}`, {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ commentId }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          setActionError(data?.error || 'Could not delete comment.')
          return
        }
        // Tombstone in place so any replies under it keep their context.
        setComments((prev) =>
          prev.map((c) => (c.id === commentId ? { ...c, deleted: true, content: '' } : c)),
        )
        onChanged?.()
      } finally {
        setDeletingId(null)
      }
    },
    [postId, onChanged],
  )

  const ordered = useMemo(() => buildThreadOrder(comments), [comments])
  const byId = useMemo(() => {
    const m = {}
    for (const c of comments) m[c.id] = c
    return m
  }, [comments])

  const liveCount = useMemo(() => comments.filter((c) => !c.deleted).length, [comments])

  // Own-comment check for the delete affordance (server re-enforces on delete).
  const myIdentity = (me?.identity || '').trim()
  const myAddr = (me?.address || '').trim()
  const ownedIds = me
    ? [
        myIdentity,
        myAddr,
        myAddr.startsWith('ecash:') ? myAddr.slice('ecash:'.length) : `ecash:${myAddr}`,
      ].filter(Boolean)
    : []

  return (
    <section id="comments" className="comments">
      <h3 className="comments-title">Comments</h3>
      <p className="comments-count">
        {liveCount} {liveCount === 1 ? 'comment' : 'comments'}
      </p>

      <CommentComposer postId={postId} onPosted={handlePosted} onConfirmed={upsertComment} />

      {actionError ? (
        <p className="commenterr" role="alert">
          {actionError}
        </p>
      ) : null}
      {error ? (
        <p className="commenterr" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="commentmuted">Loading comments…</p>
      ) : ordered.length === 0 ? (
        <p className="commentmuted">No comments yet. Be the first.</p>
      ) : (
        <ul className="commentlist">
          {ordered.map((comment) => {
            // A surviving tombstone (kept only because it has replies) is
            // anonymized — no byline, no copyable address — so it never reads as
            // "you commented [deleted]".
            const byline = comment.deleted
              ? '[deleted]'
              : (comment.author_identity && comment.author_identity.trim()) ||
                (typeof comment.payer_address === 'string' ? comment.payer_address.trim() : '') ||
                'Anonymous'
            const copyAddr =
              comment.deleted || typeof comment.payer_address !== 'string'
                ? ''
                : comment.payer_address.trim()
            const parent = comment.parent_id ? byId[comment.parent_id] : null
            const parentWho = parent?.deleted
              ? 'a deleted comment'
              : parent?.author_identity?.trim() ||
                (parent?.payer_address ? parent.payer_address.trim() : '') ||
                'a comment'
            // Tint the "Replying to @X" name with the parent's chosen handle color,
            // same as their byline — only for a handle (not a raw address/label).
            const parentColor =
              parent && !parent.deleted && parent.color && parentWho.startsWith('@')
                ? parent.color
                : null
            const canDelete =
              !comment.deleted &&
              (isAuthorSession || (byline && ownedIds.includes(byline)) || (copyAddr && ownedIds.includes(copyAddr)))
            // Any comment can be replied to (threaded by id; the reply pays the
            // parent's author 94/6, paid or legacy). Tombstones can't — nor can a
            // still-optimistic comment (no real DB id yet; Reply returns the
            // instant its background confirm swaps in the recorded row).
            const canReply = canComment && !comment.deleted && !comment.optimistic
            // The byline links to the commenter's profile (handle or address).
            const profileTo = comment.deleted ? null : profileHref(byline)
            // Carry the commenter's chosen handle color (--hc) so the byline
            // matches the feed/profile. Only for handle bylines — a raw address
            // byline gets no tint, exactly like the feed.
            const bylineStyle =
              !comment.deleted && comment.color && byline.startsWith('@')
                ? { '--hc': comment.color }
                : undefined

            return (
              <li key={comment.txid || comment.id} className="commentitem">
                {parent ? (
                  <p className="comment-replyingto">
                    <span className="comment-replyarrow">↳</span> Replying to{' '}
                    <span
                      className="comment-replyingto-who"
                      style={parentColor ? { '--hc': parentColor } : undefined}
                    >
                      {truncateIdentity(parentWho)}
                    </span>
                  </p>
                ) : null}
                <div className="commenthead">
                  <div>
                    {profileTo ? (
                      <Link href={profileTo} className="commentaddr" style={bylineStyle}>
                        {truncateIdentity(byline)}
                      </Link>
                    ) : (
                      <span className="commentaddr commentaddr--plain" style={bylineStyle}>
                        {truncateIdentity(byline)}
                      </span>
                    )}
                    {!comment.deleted && comment.isAi ? (
                      <>
                        {' '}
                        <span className="aibadge" title="AI-operated account">
                          [AI]
                        </span>
                      </>
                    ) : null}
                    <p className="commentdate">{formatCommentDate(comment.created_at)}</p>
                  </div>
                  {canDelete ? (
                    <button
                      type="button"
                      onClick={() => void handleDelete(comment.id)}
                      disabled={deletingId === comment.id}
                      className="delbtn"
                    >
                      {deletingId === comment.id ? 'Deleting…' : 'Delete'}
                    </button>
                  ) : null}
                </div>

                {comment.deleted ? (
                  <p className="commentbody commenttomb">[comment deleted]</p>
                ) : (
                  <p className="commentbody">
                    <CommentBody text={translations[comment.id] ?? comment.content} />
                  </p>
                )}

                {!comment.deleted ? (
                  <div className="commentactions">
                    {comment.txid && !comment.optimistic ? (
                      <CommentLike
                        targetTxid={comment.txid}
                        likeCount={comment.likeCount ?? 0}
                        likedByViewer={Boolean(comment.likedByViewer)}
                      />
                    ) : null}
                    {canReply && replyingTo !== comment.id ? (
                      <button
                        type="button"
                        className="commentreplybtn"
                        onClick={() => setReplyingTo(comment.id)}
                      >
                        Reply
                      </button>
                    ) : null}
                    <TranslateButton
                      kind="comment"
                      id={comment.id}
                      className="comment-tb"
                      onTranslated={(d) =>
                        setTranslations((prev) => ({ ...prev, [comment.id]: d.translated }))
                      }
                      onShowOriginal={() =>
                        setTranslations((prev) => {
                          const next = { ...prev }
                          delete next[comment.id]
                          return next
                        })
                      }
                    />
                  </div>
                ) : null}

                {replyingTo === comment.id ? (
                  <CommentComposer
                    postId={postId}
                    parentId={comment.id}
                    autoFocus
                    onPosted={handlePosted}
                    onConfirmed={upsertComment}
                    onCancel={() => setReplyingTo(null)}
                  />
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
