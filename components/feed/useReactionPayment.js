'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { normalizeTipXec } from '@/lib/feedPricing'
import { prewarmPaymentWatch } from '@/lib/ecash/watchPaymentAddress'
import { pollUntil } from '@/lib/ecash/pollUntil'
// Pocket-aware gateway: identical contract to the cashtabPay trio. Pocket
// eligible → local sign + instant broadcast (r.txid feeds the confirm poll);
// otherwise the exact extension/web-tab behavior.
import { beginPayment, completePayment, abortPayment } from '@/lib/pocket/payGateway'

// A device-local record of reactions this browser has CONFIRMED paying for, so a
// like/repost you already made can never render as un-done — which is what let a
// stale empty heart be re-paid (a double-tip). It's a belt to the server's
// likedByViewer suspenders: the server can miss you (a logged-out paid reader, or
// a like that minted no session), but this device always remembers. Keyed by
// (action:targetTxid); written only on a confirmed 'reacted', so an abandoned
// payment is never remembered. Same-device only — which is exactly the
// navigate-away-and-back case that caused the double charge.
const REACTED_LS_KEY = 'pow_reacted_v1'
function loadReacted() {
  if (typeof window === 'undefined') return {}
  try {
    return JSON.parse(window.localStorage.getItem(REACTED_LS_KEY) || '{}') || {}
  } catch {
    return {}
  }
}
function hasReacted(action, txid) {
  if (typeof window === 'undefined' || !txid || !action) return false
  return Boolean(loadReacted()[`${action}:${txid}`])
}
function rememberReacted(action, txid) {
  if (typeof window === 'undefined' || !txid || !action) return
  try {
    const m = loadReacted()
    m[`${action}:${txid}`] = 1
    window.localStorage.setItem(REACTED_LS_KEY, JSON.stringify(m))
  } catch {
    /* storage full / disabled — the server likedByViewer still covers the common case */
  }
}

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
  // Emoji reactions (feed posts) are MULTI — you can react any number of times,
  // paying each. They pass an `emoji` to startReaction and don't touch the binary
  // liked/likes state; the parent owns the per-emoji pill counts. These fire on a
  // confirmed reaction / on a cancel-or-fail so the parent can bump / revert its
  // optimistic pill. Binary like (comments) + repost pass no emoji and ignore these.
  onReacted = null,
  onReactFailed = null,
}) {
  const [likes, setLikes] = useState(likeCount)
  const [reposts, setReposts] = useState(repostCount)
  const [liked, setLiked] = useState(likedByViewer)
  const [reposted, setReposted] = useState(repostedByViewer)
  // Whether THIS device has reacted (any emoji) to the post — fills the reaction
  // trigger so you can see you already reacted. Emoji reactions are multi (you can
  // still react again), so this is a DISPLAY flag, not a re-pay guard. Persisted on
  // confirm; same-device only (no server per-viewer reaction state).
  const [reacted, setReacted] = useState(false)

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
  // The emoji of the reaction mid-payment (null for a binary like/repost).
  const pendingEmojiRef = useRef(null)

  // Viewer state is patched in AFTER mount (feed viewer-state / comments GET), so
  // re-sync when the prop flips. Safe against the optimistic tap: these only ever
  // go false→true (no un-like in v1), so a sync can't undo one.
  useEffect(() => {
    setLikes(likeCount)
  }, [likeCount])
  useEffect(() => {
    setReposts(repostCount)
  }, [repostCount])
  // OR-in this device's own confirmed reactions so a like/repost you already paid
  // for stays filled even when the server didn't recognize you (never downgrades a
  // remembered reaction to false — the whole point is it can't be re-paid).
  useEffect(() => {
    setLiked(likedByViewer || hasReacted('like', targetTxid))
  }, [likedByViewer, targetTxid])
  useEffect(() => {
    setReposted(repostedByViewer || hasReacted('repost', targetTxid))
  }, [repostedByViewer, targetTxid])
  // Seed the "already reacted" fill from this device's memory of emoji reactions.
  useEffect(() => {
    setReacted(hasReacted('react', targetTxid))
  }, [targetTxid])

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
    pendingEmojiRef.current = null
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('sessionChanged'))
    }
  }, [])

  const startReaction = useCallback(
    async (action, amountXec, emoji = null) => {
      if (startingRef.current || pending) return
      // Emoji reactions are multi — no binary "already liked" lock. Only the
      // binary like/repost paths block a repeat.
      if (!emoji && action === 'like' && liked) return
      if (action === 'repost' && reposted) return
      // A binary like (article comment) can carry a custom tip; validate it before
      // opening the wallet. Emoji reactions are flat 100 XEC (no amount).
      let amount
      if (amountXec != null) {
        amount = normalizeTipXec(amountXec)
        if (amount == null) {
          setTipError('Enter a whole number of at least 100 XEC.')
          return
        }
      }
      startingRef.current = true
      pendingEmojiRef.current = emoji
      // Fill the trigger the instant you tap an emoji (reverted on cancel/fail).
      if (emoji) setReacted(true)
      setNotice('')
      setTipError('')
      // Decide pocket-vs-Cashtab AT the click gesture (never both).
      const handle = beginPayment({ kind: action, amountXec: amount ?? 100 })
      setInPagePay(handle.mode === 'pocket' || Boolean(handle.gesture?.hasExtension))
      prewarmPaymentWatch()
      // Binary like/repost flip their own optimistic state here; an emoji
      // reaction leaves that alone (the parent owns the per-emoji pill).
      if (!emoji) applyReaction(action)
      try {
        const res = await fetch(`${endpointBase}/prepare`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            action,
            targetTxid,
            ...(amount != null ? { amountXec: amount } : {}),
            ...(emoji ? { emoji } : {}),
          }),
        })
        const data = await res.json()
        if (!res.ok || !data.ok) {
          abortPayment(handle)
          if (emoji) onReactFailed?.(emoji)
          else revertReaction(action)
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
            if (emoji) onReactFailed?.(emoji)
            else revertReaction(action)
            setPending(null)
            setIntent(null)
            setInPagePay(false)
            setNotice('Payment cancelled.')
          } else if (!r.ok && r.reason === 'pocket_error') {
            setInPagePay(false)
            setNotice(r.message || 'Pocket couldn’t send — use Open Cashtab below.')
          }
        })
        setIntent({ ...data, emoji })
        setPending(action)
      } catch {
        abortPayment(handle)
        if (emoji) onReactFailed?.(emoji)
        else revertReaction(action)
        setInPagePay(false)
        setNotice('Network hiccup — try again.')
      } finally {
        startingRef.current = false
      }
    },
    [pending, liked, reposted, targetTxid, endpointBase, applyReaction, revertReaction, onReactFailed],
  )

  // Poll for the on-chain reaction while a payment is pending, via the shared
  // pollUntil primitive: it owns the interval, the Chronik ws nudge (confirm the
  // instant the payment lands), the 429 backoff (so a stuck poll can't burn the
  // per-IP budget and 429 the user's other actions), and a lifetime cap (a
  // never-settling payment stops polling — the reaction is already flipped
  // optimistically and the tx is on-chain regardless).
  useEffect(() => {
    if (!pending || !intent) return undefined
    return pollUntil(
      async () => {
        const knownTxid = intent.knownTxid
        const res = await fetch(`${endpointBase}/confirm`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            action: pending,
            targetTxid,
            since: intent.preparedAt,
            ...(knownTxid ? { txid: knownTxid } : {}),
            ...(intent.emoji ? { emoji: intent.emoji } : {}),
          }),
        })
        if (res.status === 429) return { backoff: true }
        const data = await res.json()
        if (data.status === 'reacted') {
          if (intent.emoji) {
            // Multi-react: no re-pay GUARD (you can react again), but remember it
            // for DISPLAY so the trigger stays filled, and solidify the pill.
            onReacted?.(intent.emoji)
            rememberReacted('react', targetTxid)
          } else {
            // Remember a binary like/repost on THIS device so a later visit where
            // the server doesn't recognize us can't re-charge it.
            rememberReacted(pending, targetTxid)
          }
          finalizeReacted()
          return { done: true }
        }
        if (!res.ok) setNotice(data.error || 'Verification failed.')
        return undefined
      },
      { onWsAddress: intent.payAddress, maxLifetimeMs: 90_000 },
    )
  }, [pending, intent, targetTxid, endpointBase, finalizeReacted, onReacted])

  const verifyManual = useCallback(async () => {
    const t = txidInput.trim()
    if (!/^[0-9a-f]{64}$/i.test(t)) {
      setNotice('Enter a valid 64-character transaction ID.')
      return
    }
    setNotice('Checking that transaction…')
    const emoji = pendingEmojiRef.current
    try {
      const res = await fetch(`${endpointBase}/confirm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: pending, targetTxid, txid: t, ...(emoji ? { emoji } : {}) }),
      })
      const data = await res.json()
      if (data.status === 'reacted') {
        if (emoji) {
          onReacted?.(emoji)
          rememberReacted('react', targetTxid)
        } else rememberReacted(pending, targetTxid)
        finalizeReacted()
      } else if (data.status === 'awaiting_payment') {
        setNotice("That transaction doesn't match this reaction yet.")
      } else {
        setNotice(data.error || 'Could not verify that transaction.')
      }
    } catch {
      setNotice('Network hiccup — try again.')
    }
  }, [txidInput, pending, targetTxid, endpointBase, finalizeReacted, onReacted])

  const cancel = useCallback(() => {
    const emoji = pendingEmojiRef.current
    if (emoji) {
      onReactFailed?.(emoji) // undo the parent's optimistic pill
      setReacted(hasReacted('react', targetTxid)) // un-fill only if this was the first
    } else if (pending) revertReaction(pending) // undo the binary optimistic flip
    setPending(null)
    setIntent(null)
    setInPagePay(false)
    setTxidInput('')
    setNotice('')
  }, [pending, revertReaction, onReactFailed, targetTxid])

  return {
    likes, liked, reposts, reposted, reacted,
    pending, intent, inPagePay, notice, txidInput, setTxidInput,
    tipError,
    startReaction, verifyManual, cancel,
  }
}
