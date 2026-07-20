'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { normalizeTipXec } from '@/lib/feedPricing'
import { watchPaymentAddress, prewarmPaymentWatch } from '@/lib/ecash/watchPaymentAddress'
// Pocket-aware gateway: identical contract to the cashtabPay trio. Pocket
// eligible → local sign + instant broadcast (r.txid feeds the confirm poll);
// otherwise the exact extension/web-tab behavior this file always had.
import { beginPayment, completePayment, abortPayment } from '@/lib/pocket/payGateway'

// Quick-pick tip amounts (XEC) shown in the like menu; the field takes any custom
// amount. Labels abbreviate the thousands.
const TIP_PRESETS = [
  { xec: 100, label: '100' },
  { xec: 1000, label: '1K' },
  { xec: 10000, label: '10K' },
  { xec: 100000, label: '100K' },
  { xec: 1000000, label: '1M' },
]

/**
 * Like / Repost / Quote controls for a feed post. Likes and reposts are on-chain
 * paid actions (94/6 to the post's author/platform), so tapping one opens Cashtab
 * and then polls /api/feed/react/confirm until the payment is detected. The Like
 * button doubles as a tip: it opens a small menu to pick a preset or type any
 * amount (100 XEC minimum), so a like can send the author more than the floor.
 * Repost stays a flat 100 XEC. There is no undo in v1: once you've liked or
 * reposted, the button is shown as "on" and further taps are no-ops. Quote is
 * delegated to the parent (which opens a composer) via onQuote.
 */
export default function EngagementBar({
  targetTxid,
  likeCount = 0,
  repostCount = 0,
  quoteCount = 0,
  likedByViewer = false,
  repostedByViewer = false,
  canQuote = true,
  onQuote,
}) {
  const [likes, setLikes] = useState(likeCount)
  const [reposts, setReposts] = useState(repostCount)
  const [liked, setLiked] = useState(likedByViewer)
  const [reposted, setReposted] = useState(repostedByViewer)

  // Which reaction is mid-payment, if any: 'like' | 'repost' | null.
  const [pending, setPending] = useState(null)
  const [intent, setIntent] = useState(null)
  // True while a POCKET payment is carrying the reaction. The pocket broadcasts
  // locally and instantly, so the action reads as DONE the moment you tap — no
  // disabled button, no "recording on-chain…" panel. The confirm poll still runs,
  // silently, to record it server-side and roll back on the rare failure. Cashtab
  // (and a pocket that fails over to it) flip this false so the approve/manual UI
  // shows, because there you genuinely have to wait on the wallet.
  // True when the payment happens IN-PAGE (Pocket or the Cashtab extension) — the
  // reaction flips instantly and needs no pending panel. Only the web-tab path
  // (a separate cashtab.com tab, no signal back) shows the approve/record panel.
  const [inPagePay, setInPagePay] = useState(false)
  const [notice, setNotice] = useState('')
  const [txidInput, setTxidInput] = useState('')
  const startingRef = useRef(false)

  // Like → tip menu (revealed on hover/focus via CSS): the custom-amount field
  // and its inline validation error.
  const [tipAmount, setTipAmount] = useState('')
  const [tipError, setTipError] = useState('')

  const isLike = pending === 'like'

  // Optimistic flip: reflect the like/repost the instant you tap, so it feels
  // immediate. The payment runs in the background; startReaction blocks a second
  // tap, so this only ever applies once per reaction.
  const applyReaction = useCallback((action) => {
    if (action === 'like') { setLiked(true); setLikes((n) => n + 1) }
    else { setReposted(true); setReposts((n) => n + 1) }
  }, [])
  // Undo the optimistic flip when the payment is cancelled or fails to start.
  const revertReaction = useCallback((action) => {
    if (action === 'like') { setLiked(false); setLikes((n) => Math.max(0, n - 1)) }
    else { setReposted(false); setReposts((n) => Math.max(0, n - 1)) }
  }, [])
  // Payment confirmed: the button is already flipped, so just clear the pending
  // payment UI. Neither a like nor a repost has a page of its own — both stay put.
  const finalizeReacted = useCallback(() => {
    setPending(null)
    setIntent(null)
    setPayViaPocket(false)
    setTxidInput('')
    setNotice('')
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('sessionChanged'))
    }
  }, [])

  const startReaction = useCallback(
    async (action, amountXec) => {
      if (startingRef.current || pending) return
      if (action === 'like' && liked) return
      if (action === 'repost' && reposted) return
      // A like can carry a custom tip; validate it before opening the wallet so a
      // bad amount never reaches Cashtab. No amount → the server's 100 XEC floor.
      let amount
      if (amountXec != null) {
        amount = normalizeTipXec(amountXec)
        if (amount == null) {
          setTipError('Enter a whole number of at least 100 XEC.')
          return
        }
      }
      startingRef.current = true
      setNotice('')
      setTipError('')
      // Decide pocket-vs-Cashtab AT the click gesture (never both). Pocket
      // eligible → opens nothing at all; extension → in-page popup; else
      // pre-opens about:blank so the deep link survives popup blockers once
      // /prepare returns.
      const handle = beginPayment({ kind: action, amountXec: amount ?? 100 })
      // Pocket + the Cashtab extension carry it in-page (no pending panel); only the
      // web tab shows the approve panel. hasExtension is known here at click time.
      setInPagePay(handle.mode === 'pocket' || Boolean(handle.gesture?.hasExtension))
      // Warm the shared ws and flip the button optimistically so the reaction
      // feels instant; both are undone below if the payment can't be started.
      prewarmPaymentWatch()
      applyReaction(action)
      try {
        const res = await fetch('/api/feed/react/prepare', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            action,
            targetTxid,
            ...(amount != null ? { amountXec: amount } : {}),
          }),
        })
        const data = await res.json()
        if (!res.ok || !data.ok) {
          abortPayment(handle)
          revertReaction(action)
          setInPagePay(false)
          setNotice(data.error || 'Could not start the payment. Try again.')
          return
        }
        // Pocket signs locally (txid feeds the confirm poll below); Cashtab is
        // the extension popup or the pre-opened tab — exactly one. A rejected
        // popup undoes the optimistic flip; a pocket failure keeps the pending
        // UI, whose manual "Open Cashtab" path still completes the payment.
        void completePayment(handle, {
          bip21: data.bip21Url,
          cashtabUrl: data.cashtabUrl,
        }).then((r) => {
          // Pocket AND the extension resolve with a txid — feed it to the poll so the
          // reaction records via a direct single-tx verify (no chain scan). The web
          // tab has no txid; its poll scans the pay address as before.
          if (r.ok && r.txid) {
            setIntent((prev) => (prev ? { ...prev, knownTxid: r.txid } : prev))
          } else if (!r.ok && r.reason === 'denied') {
            revertReaction(action)
            setPending(null)
            setIntent(null)
            setInPagePay(false)
            setNotice('Payment cancelled.')
          } else if (!r.ok && r.reason === 'pocket_error') {
            // Pocket couldn't send — surface the approve/manual panel so the
            // payment can still complete via Cashtab.
            setInPagePay(false)
            setNotice(r.message || 'Pocket couldn’t send — use Open Cashtab below.')
          }
        })
        setIntent(data)
        setPending(action)
      } catch {
        abortPayment(handle)
        revertReaction(action)
        setInPagePay(false)
        setNotice('Network hiccup — try again.')
      } finally {
        startingRef.current = false
      }
    },
    [pending, liked, reposted, targetTxid, applyReaction, revertReaction],
  )

  // Poll for the on-chain reaction while a payment is pending.
  useEffect(() => {
    if (!pending || !intent) return undefined
    let stopped = false
    const check = async (manualTxid) => {
      try {
        // A pocket-paid reaction knows its txid up front — send it so confirm
        // verifies THAT tx directly (records on the first request, no scan).
        const knownTxid = manualTxid ?? intent.knownTxid
        const res = await fetch('/api/feed/react/confirm', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            action: pending,
            targetTxid,
            since: intent.preparedAt,
            ...(knownTxid ? { txid: knownTxid } : {}),
          }),
        })
        const data = await res.json()
        if (stopped) return
        if (data.status === 'reacted') {
          stopped = true
          finalizeReacted()
        } else if (!res.ok) {
          setNotice(data.error || 'Verification failed.')
        }
      } catch {
        /* keep polling */
      }
    }
    check()
    const id = setInterval(() => !stopped && check(), 1200)
    // Chronik ws nudge: confirm the instant the payment touches the payout
    // address instead of waiting for the next 1.2s tick.
    const unwatch = watchPaymentAddress(
      intent.payAddress,
      () => { if (!stopped) void check() },
      // Wake (tab back to foreground / ws reconnect): the payment may have
      // broadcast while this tab was suspended — check now, don't wait a tick.
      () => { if (!stopped) void check() },
    )
    return () => {
      stopped = true
      clearInterval(id)
      unwatch()
    }
  }, [pending, intent, targetTxid, finalizeReacted])

  const verifyManual = useCallback(async () => {
    const t = txidInput.trim()
    if (!/^[0-9a-f]{64}$/i.test(t)) {
      setNotice('Enter a valid 64-character transaction ID.')
      return
    }
    setNotice('Checking that transaction…')
    try {
      const res = await fetch('/api/feed/react/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: pending, targetTxid, txid: t }),
      })
      const data = await res.json()
      if (data.status === 'reacted') {
        finalizeReacted()
      } else if (data.status === 'awaiting_payment') {
        setNotice("That transaction doesn't match this reaction yet.")
      } else {
        setNotice(data.error || 'Could not verify that transaction.')
      }
    } catch {
      setNotice('Network hiccup — try again.')
    }
  }, [txidInput, pending, targetTxid, finalizeReacted])

  const cancel = useCallback(() => {
    if (pending) revertReaction(pending) // undo the optimistic flip
    setPending(null)
    setIntent(null)
    setPayViaPocket(false)
    setTxidInput('')
    setNotice('')
  }, [pending, revertReaction])

  return (
    <div className="engage">
      <div className="engagebar">
        <span className="likewrap">
          <button
            type="button"
            className={`likebtn${liked ? ' on' : ''}`}
            disabled={Boolean(pending) && !inPagePay}
            aria-pressed={liked}
            aria-haspopup="menu"
            aria-label={liked ? 'Liked' : 'Like'}
            title={liked ? 'You liked this' : 'Tip the author'}
          >
            <span aria-hidden className="likeico">{liked ? '♥' : '♡'}</span> {likes > 0 ? likes : ''}
          </button>
          {!liked && !pending ? (
            <div className="tipmenu" role="menu">
              <p className="tiptitle">Tip the author</p>
              <div className="tippresets">
                {TIP_PRESETS.map(({ xec, label }) => (
                  <button
                    key={xec}
                    type="button"
                    className="tippreset"
                    onClick={() => void startReaction('like', xec)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="tiprow">
                <div className="tipfield">
                  <input
                    className="tipinput"
                    value={tipAmount}
                    onChange={(e) => setTipAmount(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void startReaction('like', tipAmount)
                    }}
                    placeholder="Custom"
                    inputMode="numeric"
                    spellCheck={false}
                    aria-label="Custom tip amount in XEC"
                  />
                  <span className="tipunit">XEC</span>
                </div>
                <button
                  type="button"
                  className="tipgo"
                  onClick={() => void startReaction('like', tipAmount)}
                >
                  Tip
                </button>
              </div>
              {tipError ? <p className="notice">{tipError}</p> : null}
            </div>
          ) : null}
        </span>

        <button
          type="button"
          className={`repostbtn${reposted ? ' on' : ''}`}
          onClick={() => void startReaction('repost')}
          disabled={Boolean(pending)}
          aria-pressed={reposted}
          aria-label="Repost"
          title={reposted ? 'You reposted this' : 'Repost · 100 XEC to the author'}
        >
          🔁 {reposts > 0 ? reposts : ''}
        </button>

        {canQuote ? (
          <button
            type="button"
            className="quotebtn"
            onClick={() => onQuote?.()}
            aria-label="Quote"
            title="Quote this post"
          >
            <span aria-hidden className="qico">❝</span> {quoteCount > 0 ? quoteCount : ''}
          </button>
        ) : null}
      </div>

      {pending && intent && !inPagePay ? (
        <div className="reactpay">
          <p className="poll">
            Confirm <strong>{intent.amountXec} XEC</strong> in Cashtab to{' '}
            {isLike ? 'like' : 'repost'} this post…
          </p>
          <details className="manual">
            <summary>Cashtab didn&apos;t open, or already paid?</summary>
            <div style={{ textAlign: 'center', margin: '10px 0 0' }}>
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
          <div style={{ marginTop: '10px' }}>
            <button type="button" onClick={cancel} className="linkbtn">
              Cancel
            </button>
          </div>
        </div>
      ) : notice ? (
        <p className="notice">{notice}</p>
      ) : null}
    </div>
  )
}
