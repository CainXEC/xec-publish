'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { normalizeTipXec } from '@/lib/feedPricing'
import { watchPaymentAddress, prewarmPaymentWatch } from '@/lib/ecash/watchPaymentAddress'
// Pocket-aware gateway: identical contract to the cashtabPay trio. Pocket
// eligible → local sign + instant broadcast (r.txid feeds the confirm poll);
// otherwise the exact extension/web-tab behavior.
import { beginPayment, completePayment, abortPayment } from '@/lib/pocket/payGateway'

/**
 * The shared paid-reaction flow (like / repost) behind both EngagementBar (feed
 * posts) and CommentLike (article comments). It owns the optimistic flip, the
 * Pocket↔Cashtab payment gateway, the confirm poll + Chronik ws nudge, the
 * settle-once behavior, and tip-amount validation — the hard-won logic that must
 * live in exactly one place. The ONLY thing that differs between callers is
 * `endpointBase`: '/api/feed/react' for posts, '/api/comments/react' for
 * comments (both expose /prepare and /confirm with the same request/response
 * shape, differing only in which table the target + reaction live in).
 *
 * Returns the reaction state + the handlers a reaction UI needs; the caller owns
 * the presentation (buttons, tip menu, pending panel).
 */
export function useReactionPayment({
  endpointBase = '/api/feed/react',
  targetTxid,
  likeCount = 0,
  repostCount = 0,
  likedByViewer = false,
  repostedByViewer = false,
}) {
  const [likes, setLikes] = useState(likeCount)
  const [reposts, setReposts] = useState(repostCount)
  const [liked, setLiked] = useState(likedByViewer)
  const [reposted, setReposted] = useState(repostedByViewer)

  // Which reaction is mid-payment, if any: 'like' | 'repost' | null.
  const [pending, setPending] = useState(null)
  const [intent, setIntent] = useState(null)
  // True when the payment happens IN-PAGE (Pocket or the Cashtab extension) — the
  // reaction flips instantly and needs no pending panel. Only the web-tab path
  // (a separate cashtab.com tab, no signal back) shows the approve/record panel.
  const [inPagePay, setInPagePay] = useState(false)
  const [notice, setNotice] = useState('')
  const [txidInput, setTxidInput] = useState('')
  const [tipError, setTipError] = useState('')
  const startingRef = useRef(false)

  // Viewer state is patched in AFTER mount (feed viewer-state / comments GET), so
  // re-sync when the prop flips. Safe against the optimistic tap: these only ever
  // go false→true (no un-like in v1), so a sync can't undo one.
  useEffect(() => {
    setLikes(likeCount)
  }, [likeCount])
  useEffect(() => {
    setReposts(repostCount)
  }, [repostCount])
  useEffect(() => {
    setLiked(likedByViewer)
  }, [likedByViewer])
  useEffect(() => {
    setReposted(repostedByViewer)
  }, [repostedByViewer])

  // Optimistic flip: reflect the like/repost the instant you tap.
  const applyReaction = useCallback((action) => {
    if (action === 'like') { setLiked(true); setLikes((n) => n + 1) }
    else { setReposted(true); setReposts((n) => n + 1) }
  }, [])
  // Undo the optimistic flip when the payment is cancelled or fails to start.
  const revertReaction = useCallback((action) => {
    if (action === 'like') { setLiked(false); setLikes((n) => Math.max(0, n - 1)) }
    else { setReposted(false); setReposts((n) => Math.max(0, n - 1)) }
  }, [])
  // Payment confirmed: the button is already flipped, so just clear the pending UI.
  const finalizeReacted = useCallback(() => {
    setPending(null)
    setIntent(null)
    setInPagePay(false)
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
      // Decide pocket-vs-Cashtab AT the click gesture (never both).
      const handle = beginPayment({ kind: action, amountXec: amount ?? 100 })
      setInPagePay(handle.mode === 'pocket' || Boolean(handle.gesture?.hasExtension))
      prewarmPaymentWatch()
      applyReaction(action)
      try {
        const res = await fetch(`${endpointBase}/prepare`, {
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
        void completePayment(handle, {
          bip21: data.bip21Url,
          cashtabUrl: data.cashtabUrl,
        }).then((r) => {
          if (r.ok && r.txid) {
            setIntent((prev) => (prev ? { ...prev, knownTxid: r.txid } : prev))
          } else if (!r.ok && r.reason === 'denied') {
            revertReaction(action)
            setPending(null)
            setIntent(null)
            setInPagePay(false)
            setNotice('Payment cancelled.')
          } else if (!r.ok && r.reason === 'pocket_error') {
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
    [pending, liked, reposted, targetTxid, endpointBase, applyReaction, revertReaction],
  )

  // Poll for the on-chain reaction while a payment is pending. Self-scheduling
  // (setTimeout, not setInterval) so it can BACK OFF when the server throttles:
  // the confirm route is rate-limited per IP, and a stuck poll hammering it at a
  // fixed 1.2s would burn the whole budget (and 429 everything else). On a 429 we
  // double the delay up to a cap; a normal pending resets to the base cadence. A
  // hard lifetime cap stops a never-settling payment from polling forever — the
  // reaction is already flipped optimistically and the payment is on-chain
  // regardless, so giving up quietly costs nothing but the background noise.
  useEffect(() => {
    if (!pending || !intent) return undefined
    let stopped = false
    let timer = null
    const startedAt = Date.now()
    const BASE_DELAY = 1200
    const MAX_DELAY = 8000
    const MAX_LIFETIME = 90_000
    let delay = BASE_DELAY

    const stop = () => {
      stopped = true
      if (timer) clearTimeout(timer)
    }

    const check = async (manualTxid) => {
      if (stopped) return
      try {
        const knownTxid = manualTxid ?? intent.knownTxid
        const res = await fetch(`${endpointBase}/confirm`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            action: pending,
            targetTxid,
            since: intent.preparedAt,
            ...(knownTxid ? { txid: knownTxid } : {}),
          }),
        })
        if (stopped) return
        // Throttled: back off so we stop adding to the per-IP budget. Silent —
        // the optimistic flip already shows success; this is just settling.
        if (res.status === 429) {
          delay = Math.min(delay * 2, MAX_DELAY)
          return
        }
        const data = await res.json()
        if (stopped) return
        if (data.status === 'reacted') {
          stop()
          finalizeReacted()
        } else if (!res.ok) {
          setNotice(data.error || 'Verification failed.')
        } else {
          delay = BASE_DELAY // healthy pending — resume the normal cadence
        }
      } catch {
        /* keep polling */
      }
    }

    const loop = async () => {
      if (stopped) return
      if (Date.now() - startedAt > MAX_LIFETIME) {
        stop()
        return
      }
      await check()
      if (!stopped) timer = setTimeout(loop, delay)
    }

    void loop()
    // Chronik ws nudge: confirm the instant the payment touches the payout
    // address instead of waiting for the next tick (event-driven, off the timer).
    const unwatch = watchPaymentAddress(
      intent.payAddress,
      () => { if (!stopped) void check() },
      () => { if (!stopped) void check() },
    )
    return () => {
      stop()
      unwatch()
    }
  }, [pending, intent, targetTxid, endpointBase, finalizeReacted])

  const verifyManual = useCallback(async () => {
    const t = txidInput.trim()
    if (!/^[0-9a-f]{64}$/i.test(t)) {
      setNotice('Enter a valid 64-character transaction ID.')
      return
    }
    setNotice('Checking that transaction…')
    try {
      const res = await fetch(`${endpointBase}/confirm`, {
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
  }, [txidInput, pending, targetTxid, endpointBase, finalizeReacted])

  const cancel = useCallback(() => {
    if (pending) revertReaction(pending) // undo the optimistic flip
    setPending(null)
    setIntent(null)
    setInPagePay(false)
    setTxidInput('')
    setNotice('')
  }, [pending, revertReaction])

  return {
    likes, liked, reposts, reposted,
    pending, intent, inPagePay, notice, txidInput, setTxidInput,
    tipError,
    startReaction, verifyManual, cancel,
  }
}
