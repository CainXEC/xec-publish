'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { priceFeedPost, FEED_MAX_CHARS } from '@/lib/feedPricing'
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
//  @X" line, no indentation — and you can reply to anything (parent_txid links).
//
//  Payment mirrors the feed composer: type → /api/comments/prepare (BIP21 +
//  Cashtab link) → pay in Cashtab → poll /api/comments/confirm until the
//  on-chain payment is detected and the comment is recorded.
// =============================================================================

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
 *  conversation order without any indentation. Comments whose parent isn't in
 *  the set (legacy free comments, or a pruned parent) are treated as roots. */
function buildThreadOrder(comments) {
  const byTxid = new Map()
  for (const c of comments) if (c.txid) byTxid.set(c.txid, c)
  const childrenOf = new Map()
  const roots = []
  const byCreated = (a, b) => new Date(a.created_at) - new Date(b.created_at)
  for (const c of comments) {
    const parent = c.parent_txid && byTxid.has(c.parent_txid) ? c.parent_txid : null
    if (parent) {
      if (!childrenOf.has(parent)) childrenOf.set(parent, [])
      childrenOf.get(parent).push(c)
    } else {
      roots.push(c)
    }
  }
  const out = []
  const walk = (node) => {
    out.push(node)
    const kids = (childrenOf.get(node.txid) || []).slice().sort(byCreated)
    for (const k of kids) walk(k)
  }
  for (const r of roots.slice().sort(byCreated)) walk(r)
  return out
}

/** Compose + pay a top-level comment (parentTxid null) or a reply. */
function CommentComposer({ postId, parentTxid = null, autoFocus = false, onPosted, onCancel }) {
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
  const isReply = Boolean(parentTxid)

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus()
  }, [autoFocus])

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
        body: JSON.stringify({ postId, content, parentTxid }),
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
  }, [content, parentTxid, postId, priced.ok, resetToCompose])

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
            parentTxid,
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
  }, [phase, intent, content, parentTxid, postId, handlePosted])

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
        body: JSON.stringify({ postId, content, parentTxid, txid: t }),
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
  }, [txidInput, content, parentTxid, postId, handlePosted])

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
        <span className={`charcount${over ? ' over' : ''}`}>
          {chars}/{FEED_MAX_CHARS}
        </span>
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
  const byTxid = useMemo(() => {
    const m = {}
    for (const c of comments) if (c.txid) m[c.txid] = c
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
            const byline =
              (comment.author_identity && comment.author_identity.trim()) ||
              (typeof comment.payer_address === 'string' ? comment.payer_address.trim() : '') ||
              'Anonymous'
            const copyAddr =
              typeof comment.payer_address === 'string' ? comment.payer_address.trim() : ''
            const parent = comment.parent_txid ? byTxid[comment.parent_txid] : null
            const parentWho =
              parent?.author_identity?.trim() ||
              (parent?.payer_address ? parent.payer_address.trim() : '') ||
              'a comment'
            const canDelete =
              !comment.deleted &&
              (isAuthorSession || (byline && ownedIds.includes(byline)) || (copyAddr && ownedIds.includes(copyAddr)))
            // Only paid comments (with a txid) can be replied to (a reply targets
            // its parent's txid and pays that author); tombstones can't.
            const canReply = canComment && Boolean(comment.txid) && !comment.deleted

            return (
              <li key={comment.id} className="commentitem">
                {parent ? (
                  <p className="comment-replyingto">
                    <span className="comment-replyarrow">↳</span> Replying to{' '}
                    <span className="comment-replyingto-who">{parentWho}</span>
                  </p>
                ) : null}
                <div className="commenthead">
                  <div>
                    <p
                      className="commentaddr"
                      title={copyAddr ? 'Click to copy' : undefined}
                      onClick={() => copyAddr && void handleCopy(comment.id, copyAddr)}
                    >
                      {byline}
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
                  <p className="commentbody">{comment.content}</p>
                )}

                {canReply ? (
                  <div className="commentactions">
                    <button
                      type="button"
                      className="commentreplybtn"
                      onClick={() =>
                        setReplyingTo((cur) => (cur === comment.txid ? null : comment.txid))
                      }
                    >
                      {replyingTo === comment.txid ? 'Cancel' : 'Reply'}
                    </button>
                  </div>
                ) : null}

                {replyingTo === comment.txid ? (
                  <CommentComposer
                    postId={postId}
                    parentTxid={comment.txid}
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
