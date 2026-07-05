'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { priceFeedPost, FEED_MAX_CHARS } from '@/lib/feedPricing'
import QuotedEmbed from '@/components/feed/QuotedEmbed'

/**
 * Compose + pay flow for a feed post, reply, or quote. Shared by the top-of-feed
 * composer (action="post"), inline reply composers (action="reply"), and the
 * quote composer (action="quote", with quotedTxid + quotedPost for the preview).
 *
 * Flow: type → POST /api/feed/prepare (returns BIP21 + Cashtab link) → user pays
 * in Cashtab → we poll POST /api/feed/confirm until the on-chain payment is
 * detected and the post is recorded, then call onPosted(post).
 */
export default function ComposeBox({
  action = 'post',
  parentTxid = null,
  quotedTxid = null,
  quotedPost = null,
  onPosted,
  onCancel,
  compact = false,
  autoFocus = false,
  placeholder,
}) {
  const [content, setContent] = useState('')
  const [phase, setPhase] = useState('compose') // 'compose' | 'paying'
  const [intent, setIntent] = useState(null)
  const [statusMsg, setStatusMsg] = useState('Waiting for payment…')
  const [notice, setNotice] = useState('')
  const [txidInput, setTxidInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const textareaRef = useRef(null)

  const priced = priceFeedPost(content)
  const chars = priced.chars
  const overCap = chars > FEED_MAX_CHARS
  const canSubmit = priced.ok && !submitting

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus()
  }, [autoFocus])

  const resetToCompose = useCallback(() => {
    setPhase('compose')
    setIntent(null)
    setNotice('')
    setTxidInput('')
    setStatusMsg('Waiting for payment…')
  }, [])

  const startPayment = useCallback(async () => {
    if (!priced.ok) return
    setSubmitting(true)
    setNotice('')
    // Open the tab synchronously inside the click gesture, then point it at
    // Cashtab once /prepare returns. Opening after the await would be swallowed
    // by popup blockers, so we grab the handle now and set its URL later.
    // NOTE: no 'noopener' feature here — with it, window.open returns null and
    // we'd lose the handle. We sever the opener link manually once it's open.
    const payWindow =
      typeof window !== 'undefined' ? window.open('about:blank', '_blank') : null
    if (payWindow) payWindow.opener = null
    try {
      const res = await fetch('/api/feed/prepare', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content, action, parentTxid, quotedTxid }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        payWindow?.close()
        setNotice(data.error || 'Could not start the payment. Try again.')
        return
      }
      if (payWindow) {
        payWindow.location.href = data.cashtabUrl
      }
      setIntent(data)
      setPhase('paying')
    } catch {
      payWindow?.close()
      setNotice('Network hiccup — try again.')
    } finally {
      setSubmitting(false)
    }
  }, [content, action, parentTxid, quotedTxid, priced.ok])

  // Poll for the on-chain payment while paying.
  useEffect(() => {
    if (phase !== 'paying' || !intent) return undefined
    let stopped = false
    const confirm = async (manualTxid) => {
      try {
        const res = await fetch('/api/feed/confirm', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            content,
            action,
            parentTxid,
            quotedTxid,
            since: intent.preparedAt,
            ...(manualTxid ? { txid: manualTxid } : {}),
          }),
        })
        const data = await res.json()
        if (stopped) return
        if (data.status === 'posted' && data.post) {
          stopped = true
          // The confirm route returns the bare inserted row with no `quoted`
          // preview, so attach the one we already have to avoid a transient
          // "Quoted post unavailable." until the next server render.
          onPosted?.(
            action === 'quote' && quotedPost
              ? { ...data.post, quoted: quotedPost }
              : data.post,
          )
          setContent('')
          resetToCompose()
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('sessionChanged'))
          }
        } else if (data.status === 'finalizing') {
          setStatusMsg('Finalizing payment…')
        } else if (!res.ok) {
          setNotice(data.error || 'Verification failed.')
        }
      } catch {
        /* keep polling */
      }
    }
    confirm()
    const id = setInterval(() => !stopped && confirm(), 2500)
    return () => {
      stopped = true
      clearInterval(id)
    }
  }, [phase, intent, content, action, parentTxid, quotedTxid, quotedPost, onPosted, resetToCompose])

  const verifyManual = useCallback(async () => {
    const t = txidInput.trim()
    if (!/^[0-9a-f]{64}$/i.test(t)) {
      setNotice('Enter a valid 64-character transaction ID.')
      return
    }
    setNotice('Checking that transaction…')
    try {
      const res = await fetch('/api/feed/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content, action, parentTxid, quotedTxid, txid: t }),
      })
      const data = await res.json()
      if (data.status === 'posted' && data.post) {
        onPosted?.(
          action === 'quote' && quotedPost
            ? { ...data.post, quoted: quotedPost }
            : data.post,
        )
        setContent('')
        resetToCompose()
      } else if (data.status === 'finalizing') {
        setNotice('Payment seen — finalizing. This clears in a few seconds.')
      } else if (data.status === 'awaiting_payment') {
        setNotice("That transaction doesn't match this post yet.")
      } else {
        setNotice(data.error || 'Could not verify that transaction.')
      }
    } catch {
      setNotice('Network hiccup — try again.')
    }
  }, [txidInput, content, action, parentTxid, quotedTxid, quotedPost, onPosted, resetToCompose])

  const isReply = action === 'reply'
  const isQuote = action === 'quote'
  const noun = isReply ? 'reply' : isQuote ? 'quote' : 'post'
  const verb = isReply ? 'Reply' : isQuote ? 'Quote' : 'Post'

  if (phase === 'paying' && intent) {
    return (
      <div className="panel pay">
        <p className="payhead">
          Cashtab opened for <strong>{intent.amountXec} XEC</strong>. Confirm the {noun} there.
        </p>
        <p className="poll">{statusMsg}</p>

        <details className="manual">
          <summary>Cashtab didn&apos;t open, or already paid?</summary>
          <div style={{ textAlign: 'center', margin: '12px 0 0' }}>
            <a href={intent.cashtabUrl} target="_blank" rel="noreferrer" className="ghost">
              Open in Cashtab
            </a>
          </div>
          <div className="manualrow">
            <input
              value={txidInput}
              onChange={(e) => setTxidInput(e.target.value)}
              placeholder="Paste the transaction ID"
              spellCheck={false}
            />
            <button type="button" onClick={() => void verifyManual()} className="btn">
              Verify
            </button>
          </div>
        </details>

        {notice ? <p className="notice">{notice}</p> : null}

        <div style={{ marginTop: '16px' }}>
          <button type="button" onClick={() => resetToCompose()} className="linkbtn">
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={`panel compose${compact ? ' compact' : ''}`}>
      <textarea
        ref={textareaRef}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={isReply ? 2 : 3}
        placeholder={
          placeholder ||
          (isReply ? 'Post your reply…' : isQuote ? 'Add a comment…' : "What's happening?")
        }
      />
      {isQuote ? <QuotedEmbed post={quotedPost} interactive={false} /> : null}
      <div className="composebar">
        <span className={`count${overCap ? ' over' : ''}`}>
          {chars}/{FEED_MAX_CHARS}
          {priced.ok ? <span className="cost">{priced.costXec} XEC</span> : null}
        </span>
        <div className="barbtns">
          {(isReply || isQuote) && onCancel ? (
            <button type="button" onClick={onCancel} className="ghost">
              Cancel
            </button>
          ) : null}
          <button type="button" disabled={!canSubmit} onClick={() => void startPayment()} className="btn">
            {verb}
            {priced.ok ? ` · ${priced.costXec} XEC` : ''}
          </button>
        </div>
      </div>
      {notice ? <p className="notice">{notice}</p> : null}
    </div>
  )
}
