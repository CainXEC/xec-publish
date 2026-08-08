'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { normalizeTipXec } from '@/lib/feedPricing'
import { prewarmPaymentWatch } from '@/lib/ecash/watchPaymentAddress'
import { pollUntil } from '@/lib/ecash/pollUntil'
// Pocket-aware gateway: identical contract to the cashtabPay trio. Pocket
// eligible → local sign + instant broadcast (r.txid feeds the confirm poll);
// otherwise the exact extension/web-tab behavior.
import { beginPayment, completePayment, abortPayment } from '@/lib/pocket/payGateway'

/**
 * The paid-tip flow behind the profile "Tip" button. It mirrors
 * useReactionPayment (the feed like/repost hook) — same Pocket↔Cashtab gateway,
 * the same confirm poll + Chronik ws nudge, the same 429 backoff / lifetime cap —
 * but a tip targets an ACCOUNT (the author), not a post, pays 100% to the author
 * (no platform fee), and is REPEATABLE: there's no "already tipped" latch, so a
 * fan can tip again as soon as one send settles.
 *
 * Returns the state + handlers a tip UI needs; the caller owns presentation.
 */
export function useTipPayment({ toAccountId }) {
  // A tip is in flight (payment started, awaiting on-chain confirmation).
  const [pending, setPending] = useState(false)
  const [intent, setIntent] = useState(null)
  // True when the payment happens IN-PAGE (Pocket or the Cashtab extension) — no
  // pending panel needed. Only the web-tab path shows the approve/record panel.
  const [inPagePay, setInPagePay] = useState(false)
  const [notice, setNotice] = useState('')
  const [txidInput, setTxidInput] = useState('')
  const [tipError, setTipError] = useState('')
  // Transient "Sent!" acknowledgement after a tip confirms; auto-clears so the
  // menu is usable again (tips are repeatable).
  const [justTipped, setJustTipped] = useState(false)
  const startingRef = useRef(false)

  const reset = useCallback(() => {
    setPending(false)
    setIntent(null)
    setInPagePay(false)
    setTxidInput('')
    setNotice('')
  }, [])

  // Payment confirmed: clear the pending UI and flash "Sent!" for a few seconds.
  const finalizeTipped = useCallback(() => {
    reset()
    setJustTipped(true)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('sessionChanged'))
    }
  }, [reset])

  useEffect(() => {
    if (!justTipped) return undefined
    const t = setTimeout(() => setJustTipped(false), 4000)
    return () => clearTimeout(t)
  }, [justTipped])

  const startTip = useCallback(
    async (amountXec) => {
      if (startingRef.current || pending) return
      const amount = normalizeTipXec(amountXec)
      if (amount == null) {
        setTipError('Enter a whole number of at least 100 XEC.')
        return
      }
      if (!toAccountId) {
        setNotice('This author can’t receive tips yet.')
        return
      }
      startingRef.current = true
      setNotice('')
      setTipError('')
      setJustTipped(false)
      // Decide pocket-vs-Cashtab AT the click gesture (never both).
      const handle = beginPayment({ kind: 'tip', amountXec: amount })
      setInPagePay(handle.mode === 'pocket' || Boolean(handle.gesture?.hasExtension))
      prewarmPaymentWatch()
      try {
        const res = await fetch('/api/profile/tip/prepare', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ toAccountId, amountXec: amount }),
        })
        const data = await res.json()
        if (!res.ok || !data.ok) {
          abortPayment(handle)
          setInPagePay(false)
          setNotice(data.error || 'Could not start the tip. Try again.')
          return
        }
        void completePayment(handle, {
          bip21: data.bip21Url,
          cashtabUrl: data.cashtabUrl,
        }).then((r) => {
          if (r.ok && r.txid) {
            setIntent((prev) => (prev ? { ...prev, knownTxid: r.txid } : prev))
          } else if (!r.ok && r.reason === 'denied') {
            reset()
            setNotice('Tip cancelled.')
          } else if (!r.ok && r.reason === 'pocket_error') {
            setInPagePay(false)
            setNotice(r.message || 'Pocket couldn’t send — use Open Cashtab below.')
          }
        })
        setIntent(data)
        setPending(true)
      } catch {
        abortPayment(handle)
        setInPagePay(false)
        setNotice('Network hiccup — try again.')
      } finally {
        startingRef.current = false
      }
    },
    [pending, toAccountId, reset],
  )

  // Poll for the on-chain tip while a payment is pending, via the shared pollUntil
  // primitive (interval + Chronik ws nudge + 429 backoff + lifetime cap).
  useEffect(() => {
    if (!pending || !intent) return undefined
    return pollUntil(
      async () => {
        const knownTxid = intent.knownTxid
        const res = await fetch('/api/profile/tip/confirm', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            toAccountId,
            since: intent.preparedAt,
            ...(knownTxid ? { txid: knownTxid } : {}),
          }),
        })
        if (res.status === 429) return { backoff: true }
        const data = await res.json()
        if (data.status === 'tipped') {
          finalizeTipped()
          return { done: true }
        }
        if (!res.ok) setNotice(data.error || 'Verification failed.')
        return undefined
      },
      { onWsAddress: intent.payAddress, maxLifetimeMs: 90_000 },
    )
  }, [pending, intent, toAccountId, finalizeTipped])

  const verifyManual = useCallback(async () => {
    const t = txidInput.trim()
    if (!/^[0-9a-f]{64}$/i.test(t)) {
      setNotice('Enter a valid 64-character transaction ID.')
      return
    }
    setNotice('Checking that transaction…')
    try {
      const res = await fetch('/api/profile/tip/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ toAccountId, txid: t }),
      })
      const data = await res.json()
      if (data.status === 'tipped') {
        finalizeTipped()
      } else if (data.status === 'awaiting_payment') {
        setNotice("That transaction doesn't match this tip yet.")
      } else {
        setNotice(data.error || 'Could not verify that transaction.')
      }
    } catch {
      setNotice('Network hiccup — try again.')
    }
  }, [txidInput, toAccountId, finalizeTipped])

  const cancel = useCallback(() => {
    reset()
  }, [reset])

  return {
    pending, intent, inPagePay, notice, txidInput, setTxidInput,
    tipError, justTipped,
    startTip, verifyManual, cancel,
  }
}
