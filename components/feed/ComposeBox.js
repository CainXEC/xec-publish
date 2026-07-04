'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { priceFeedPost, FEED_MAX_CHARS } from '@/lib/feedPricing'

/**
 * Compose + pay flow for a feed post or reply. Shared by the top-of-feed
 * composer (action="post") and inline reply composers (action="reply").
 *
 * Flow: type → POST /api/feed/prepare (returns BIP21 + Cashtab link) → user pays
 * in Cashtab → we poll POST /api/feed/confirm until the on-chain payment is
 * detected and the post is recorded, then call onPosted(post).
 */
export default function ComposeBox({
  action = 'post',
  parentTxid = null,
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
    try {
      const res = await fetch('/api/feed/prepare', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content, action, parentTxid }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        setNotice(data.error || 'Could not start the payment. Try again.')
        return
      }
      setIntent(data)
      setPhase('paying')
    } catch {
      setNotice('Network hiccup — try again.')
    } finally {
      setSubmitting(false)
    }
  }, [content, action, parentTxid, priced.ok])

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
            since: intent.preparedAt,
            ...(manualTxid ? { txid: manualTxid } : {}),
          }),
        })
        const data = await res.json()
        if (stopped) return
        if (data.status === 'posted' && data.post) {
          stopped = true
          onPosted?.(data.post)
          setContent('')
          resetToCompose()
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('sessionChanged'))
          }
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
  }, [phase, intent, content, action, parentTxid, onPosted, resetToCompose])

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
        body: JSON.stringify({ content, action, parentTxid, txid: t }),
      })
      const data = await res.json()
      if (data.status === 'posted' && data.post) {
        onPosted?.(data.post)
        setContent('')
        resetToCompose()
      } else if (data.status === 'awaiting_payment') {
        setNotice("That transaction doesn't match this post yet.")
      } else {
        setNotice(data.error || 'Could not verify that transaction.')
      }
    } catch {
      setNotice('Network hiccup — try again.')
    }
  }, [txidInput, content, action, parentTxid, onPosted, resetToCompose])

  const isReply = action === 'reply'

  if (phase === 'paying' && intent) {
    return (
      <div className="panel pay">
        <p className="payhead">
          Send <strong>{intent.amountXec} XEC</strong> to {isReply ? 'post your reply' : 'publish your post'}.
        </p>
        <div className="qr">
          <QRCodeSVG value={intent.bip21Url} size={168} bgColor="#dffff2" fgColor="#05130d" />
        </div>
        <div>
          <a href={intent.cashtabUrl} target="_blank" rel="noreferrer" className="btn">
            Open in Cashtab
          </a>
        </div>
        <p className="poll">{statusMsg}</p>

        <details className="manual">
          <summary>Already paid? Enter the transaction ID</summary>
          <div className="manualrow">
            <input
              value={txidInput}
              onChange={(e) => setTxidInput(e.target.value)}
              placeholder="txid"
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
        placeholder={placeholder || (isReply ? 'Post your reply…' : "What's happening?")}
      />
      <div className="composebar">
        <span className={`count${overCap ? ' over' : ''}`}>
          {chars}/{FEED_MAX_CHARS}
          {priced.ok ? <span className="cost">{priced.costXec} XEC</span> : null}
        </span>
        <div className="barbtns">
          {isReply && onCancel ? (
            <button type="button" onClick={onCancel} className="ghost">
              Cancel
            </button>
          ) : null}
          <button type="button" disabled={!canSubmit} onClick={() => void startPayment()} className="btn">
            {isReply ? 'Reply' : 'Post'}
            {priced.ok ? ` · ${priced.costXec} XEC` : ''}
          </button>
        </div>
      </div>
      {notice ? <p className="notice">{notice}</p> : null}
    </div>
  )
}
