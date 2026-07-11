'use client'
// =============================================================================
//  PaneComments.js — comments inside the reading pane, for entitled readers.
//
//  Mirrors the article page's comment section against the SAME endpoints:
//  GET /api/comments/[postId] for the list, POST with { content } to add one
//  (authorization is entirely server-side — author/admin session, an unlock
//  row on the account's address, or the signed unlock cookie the pane's own
//  unlock flow just minted). Rendered only when the reader is entitled, the
//  same rule the article page uses. Deleting a comment stays on the story's
//  own page.
// =============================================================================

import { useCallback, useEffect, useState } from 'react'

const COMMENT_MAX_LEN = 500

const shortAddr = (address) => {
  const bare = String(address ?? '').replace(/^ecash:/, '')
  if (bare.length <= 14) return bare
  return `${bare.slice(0, 8)}…${bare.slice(-4)}`
}

const fmtWhen = (iso) => {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  } catch {
    return ''
  }
}

export default function PaneComments({ postId }) {
  const [comments, setComments] = useState(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/comments/${encodeURIComponent(postId)}`, {
        cache: 'no-store',
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) setComments(Array.isArray(data.comments) ? data.comments : [])
    } catch {
      /* the section just stays quiet */
    }
  }, [postId])

  useEffect(() => {
    void load()
  }, [load])

  const post = useCallback(async () => {
    const content = text.trim()
    if (!content || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/comments/${encodeURIComponent(postId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error || 'Could not post the comment.')
        return
      }
      setText('')
      await load()
    } catch {
      setError('Network hiccup — try again.')
    } finally {
      setBusy(false)
    }
  }, [postId, text, busy, load])

  const list = comments ?? []

  return (
    <section className="hr-comments">
      <h3 className="hr-comments-title">Comments</h3>
      <p className="hr-comments-count">
        {comments === null
          ? '…'
          : `${list.length} ${list.length === 1 ? 'comment' : 'comments'}`}
      </p>

      {list.map((c) => (
        <div className="hr-comment" key={c.id}>
          <p className="hr-comment-meta">
            <span className="hr-comment-who">{shortAddr(c.payer_address)}</span>
            {' · '}
            {fmtWhen(c.created_at)}
          </p>
          <p className="hr-comment-body">{c.content}</p>
        </div>
      ))}

      <div className="hr-commentform">
        <textarea
          rows={3}
          maxLength={COMMENT_MAX_LEN}
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, COMMENT_MAX_LEN))}
          className="hr-commentarea"
          placeholder="Share your thoughts…"
          aria-label="Add a comment"
        />
        <div className="hr-commentrow">
          <span className="hr-commentcount">{text.length}/{COMMENT_MAX_LEN}</span>
          <button
            type="button"
            className="hr-commentbtn"
            disabled={busy || !text.trim()}
            onClick={() => void post()}
          >
            {busy ? 'Posting…' : 'Post comment'}
          </button>
        </div>
        {error ? <p className="hr-commenterr" role="alert">{error}</p> : null}
      </div>
    </section>
  )
}
