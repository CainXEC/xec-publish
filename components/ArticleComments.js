'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { priceFeedPost, FEED_MAX_CHARS } from '@/lib/feedPricing'
import TranslateButton from '@/components/TranslateButton'
import EmojiPicker from '@/components/EmojiPicker'
import { watchPaymentAddress, prewarmPaymentWatch } from '@/lib/ecash/watchPaymentAddress'
import {
  beginCashtabPayment,
  completeCashtabPayment,
  abortCashtabPayment,
} from '@/lib/ecash/cashtabPay'

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

/** Compose + pay a top-level comment (parentId null) or a reply. */
function CommentComposer({ postId, parentId = null, autoFocus = false, onPosted, onCancel }) {
  const [content, setContent] = useState('')
  const [phase, setPhase] = useState('compose') // 'compose' | 'paying'
  const [intent, setIntent] = useState(null)
  const [notice, setNotice] = useState('')
  const [txidInput, setTxidInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
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
    const gesture = beginCashtabPayment()
    try {
      const res = await fetch('/api/comments/prepare', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ postId, content, parentId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) {
        abortCashtabPayment(gesture)
        setNotice(data.error || 'Could not start the payment. Try again.')
        return
      }
      void completeCashtabPayment(gesture, {
        bip21: data.bip21Url,
        cashtabUrl: data.cashtabUrl,
      }).then((r) => {
        if (!r.ok && r.reason === 'denied') {
          resetToCompose()
          setNotice('Payment cancelled — your draft is safe.')
        }
      })
      setIntent(data)
      setPhase('paying')
    } catch {
      abortCashtabPayment(gesture)
      setNotice('Network hiccup — try again.')
    } finally {
      setSubmitting(false)
    }
  }, [content, parentId, postId, priced.ok, resetToCompose])

  // Poll for the on-chain payment while paying.
  useEffect(() => {
    if (phase !== 'paying' || !intent) return undefined
    let stopped = false
    const confirm = async (manualTxid) => {
      try {
        const res = await fetch('/api/comments/confirm', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            postId,
            content,
            parentId,
            since: intent.preparedAt,
            ...(manualTxid ? { txid: manualTxid } : {}),
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (stopped) return
        if (data.status === 'posted' && data.comment) {
          stopped = true
          handlePosted(data.comment)
        } else if (!res.ok) {
          setNotice(data.error || 'Verification failed.')
        }
      } catch {
        /* keep polling */
      }
    }
    confirm()
    const id = setInterval(() => !stopped && confirm(), 1200)
    const unwatch = watchPaymentAddress(
      intent.payAddress,
      (txid) => { if (!stopped) void confirm(txid) },
      () => { if (!stopped) void confirm() },
    )
    return () => {
      stopped = true
      clearInterval(id)
      unwatch()
    }
  }, [phase, intent, content, parentId, postId, handlePosted])

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
  const [copiedIds, setCopiedIds] = useState({})
  const [translations, setTranslations] = useState({}) // { [commentId]: translatedText }
  const copyTimeouts = useRef({})

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

  useEffect(
    () => () => {
      Object.values(copyTimeouts.current).forEach((t) => clearTimeout(t))
    },
    [],
  )

  const handlePosted = useCallback(
    (comment) => {
      setComments((prev) => {
        if (comment.txid && prev.some((c) => c.txid === comment.txid)) return prev
        return [...prev, { ...comment, deleted: false }]
      })
      setReplyingTo(null)
      onChanged?.()
    },
    [onChanged],
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

  const handleCopy = useCallback(async (id, addr) => {
    if (!id || !addr) return
    try {
      await navigator.clipboard.writeText(addr)
      setCopiedIds((prev) => ({ ...prev, [id]: true }))
      if (copyTimeouts.current[id]) clearTimeout(copyTimeouts.current[id])
      copyTimeouts.current[id] = window.setTimeout(() => {
        setCopiedIds((prev) => ({ ...prev, [id]: false }))
        delete copyTimeouts.current[id]
      }, 2000)
    } catch {
      /* ignore */
    }
  }, [])

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

      <CommentComposer postId={postId} onPosted={handlePosted} />

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
            const canDelete =
              !comment.deleted &&
              (isAuthorSession || (byline && ownedIds.includes(byline)) || (copyAddr && ownedIds.includes(copyAddr)))
            // Any comment can be replied to (threaded by id; the reply pays the
            // parent's author 94/6, paid or legacy). Tombstones can't.
            const canReply = canComment && !comment.deleted

            return (
              <li key={comment.id} className="commentitem">
                {parent ? (
                  <p className="comment-replyingto">
                    <span className="comment-replyarrow">↳</span> Replying to{' '}
                    <span className="comment-replyingto-who">{truncateIdentity(parentWho)}</span>
                  </p>
                ) : null}
                <div className="commenthead">
                  <div>
                    <p
                      className="commentaddr"
                      title={copyAddr ? 'Click to copy' : undefined}
                      onClick={() => copyAddr && void handleCopy(comment.id, copyAddr)}
                    >
                      {truncateIdentity(byline)}
                    </p>
                    {copiedIds[comment.id] ? <p className="commentcopied">Copied!</p> : null}
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
                  <p className="commentbody">{translations[comment.id] ?? comment.content}</p>
                )}

                {!comment.deleted ? (
                  <div className="commentactions">
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
