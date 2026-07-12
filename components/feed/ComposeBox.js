'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { priceFeedPost, FEED_MAX_CHARS } from '@/lib/feedPricing'
import QuotedEmbed from '@/components/feed/QuotedEmbed'
import { watchPaymentAddress, prewarmPaymentWatch } from '@/lib/ecash/watchPaymentAddress'
import { beginCashtabPayment, completeCashtabPayment, abortCashtabPayment } from '@/lib/ecash/cashtabPay'

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
  initialContent = '',
}) {
  const [content, setContent] = useState(initialContent)
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

  // Auto-grow the composer to fit what you're typing (up to a cap, then scroll),
  // so long posts stay readable while composing. Runs on every content change,
  // including the initial prefill and the reset-to-empty after a successful post.
  const autosize = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 360)}px`
  }, [])

  useEffect(() => {
    autosize()
  }, [content, autosize])

  const resetToCompose = useCallback(() => {
    setPhase('compose')
    setIntent(null)
    setNotice('')
    setTxidInput('')
    setStatusMsg('Waiting for payment…')
  }, [])

  // Shared success handler for the poll + manual-verify paths. Hands the new
  // post up and clears the composer. Where the viewer lands is the parent's call,
  // not ours: on the feed a post/quote is prepended to the top and the reply
  // nests under its parent (both stay on the page); only the thread-page composer
  // navigates, since a quote made there has nowhere on that page to appear.
  const handlePosted = useCallback(
    (post) => {
      onPosted?.(
        action === 'quote' && quotedPost ? { ...post, quoted: quotedPost } : post,
      )
      setContent('')
      resetToCompose()
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('sessionChanged'))
      }
    },
    [action, quotedPost, onPosted, resetToCompose],
  )

  const startPayment = useCallback(async () => {
    if (!priced.ok) return
    setSubmitting(true)
    setNotice('')
    // Warm the shared Chronik ws now (before /prepare + Cashtab approval) so the
    // payment-address subscription is live the moment the payment lands.
    prewarmPaymentWatch()
    // Decide extension-vs-tab AT the click gesture (never both). With the
    // Cashtab extension this opens nothing; without it, it pre-opens about:blank
    // so the deep link survives popup blockers once /prepare returns.
    const gesture = beginCashtabPayment()
    try {
      const res = await fetch('/api/feed/prepare', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content, action, parentTxid, quotedTxid }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        abortCashtabPayment(gesture)
        setNotice(data.error || 'Could not start the payment. Try again.')
        return
      }
      // Extension popup or the pre-opened tab — exactly one. A rejected popup
      // drops back to the composer with the draft intact.
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
          // preview, so handlePosted attaches the one we already have to avoid a
          // transient "Quoted post unavailable." until the next server render.
          handlePosted(data.post)
        } else if (!res.ok) {
          setNotice(data.error || 'Verification failed.')
        }
      } catch {
        /* keep polling */
      }
    }
    confirm()
    const id = setInterval(() => !stopped && confirm(), 1200)
    // Chronik ws nudge: the instant a tx touches the pay address, confirm now
    // instead of waiting for the next 1.2s tick. Pass the ws's txid straight
    // through so the server does a single-tx lookup (verifyFeedTxid) instead of
    // scanning the busy platform address's recent history — a post/reply/quote
    // is disambiguated by its content hash, so a cross-fired txid just misses
    // and polling continues. Server still verifies + gates.
    const unwatch = watchPaymentAddress(
      intent.payAddress,
      (txid) => { if (!stopped) void confirm(txid) },
      // Wake (tab back to foreground / ws reconnect): the payment may have
      // broadcast while this tab was suspended — check now, don't wait a tick.
      () => { if (!stopped) void confirm() },
    )
    return () => {
      stopped = true
      clearInterval(id)
      unwatch()
    }
  }, [phase, intent, content, action, parentTxid, quotedTxid, handlePosted])

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
        handlePosted(data.post)
      } else if (data.status === 'awaiting_payment') {
        setNotice("That transaction doesn't match this post yet.")
      } else {
        setNotice(data.error || 'Could not verify that transaction.')
      }
    } catch {
      setNotice('Network hiccup — try again.')
    }
  }, [txidInput, content, action, parentTxid, quotedTxid, handlePosted])

  const isReply = action === 'reply'
  const isQuote = action === 'quote'
  const noun = isReply ? 'reply' : isQuote ? 'quote' : 'post'

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
        </span>
        <div className="barbtns">
          {(isReply || isQuote) && onCancel ? (
            <button type="button" onClick={onCancel} className="ghost">
              Cancel
            </button>
          ) : null}
          <button type="button" disabled={!canSubmit} onClick={() => void startPayment()} className="btn">
            {priced.ok ? `Pay · ${priced.costXec} XEC` : 'Pay'}
          </button>
        </div>
      </div>
      {notice ? <p className="notice">{notice}</p> : null}
    </div>
  )
}
