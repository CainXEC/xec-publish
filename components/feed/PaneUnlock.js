'use client'
// =============================================================================
//  PaneUnlock.js — pay-to-unlock INSIDE the reading pane.
//
//  A lean port of the article page's battle-tested unlock loop (see
//  PostPageClient.js), built from the same primitives so the two flows can't
//  drift on anything that matters: computePaymentSplit + buildPaywallBip21
//  (94/6 split, OP_7 POWR marker), Cashtab web-wallet deep link, baseline →
//  poll /api/latest-tx on the author's address every 1.2s with a Chronik
//  websocket nudge, POST /api/verify-payment per new txid (202 = finalizing,
//  retry the SAME txid until Avalanche finality), and the check-unlock
//  fallback for an "already used" race. The server verifies everything and
//  mints the pay-scope session — this component is only choreography.
//
//  On success the parent refetches the reader payload; the server, now
//  seeing entitlement, returns the full story and the paywall block simply
//  disappears from under this component.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { buildPaywallBip21, computePaymentSplit } from '@/lib/paymentSplit'
import { encodeFeedOpReturnRaw, FEED_ACTION } from '@/lib/feedProtocol'
import { watchPaymentAddress, prewarmPaymentWatch } from '@/lib/ecash/watchPaymentAddress'
import { payWithCashtab } from '@/lib/ecash/cashtabPay'
import { triggerPaymentSuccessEffect } from '@/lib/paymentSuccessEffect'

export default function PaneUnlock({ postId, priceXec, authorAddress, slug, onUnlocked }) {
  const [phase, setPhase] = useState('idle') // idle | watching | finalizing
  const pollRef = useRef(null)
  const watchRef = useRef(null)
  const baselineRef = useRef('')
  const handledRef = useRef('')
  const doneRef = useRef(false)

  const platformAddress = (process.env.NEXT_PUBLIC_PLATFORM_XEC_ADDRESS ?? '').trim()
  const split = priceXec != null ? computePaymentSplit(priceXec) : null
  const bip21 =
    authorAddress && platformAddress && split
      ? buildPaywallBip21(
          authorAddress,
          platformAddress,
          split.authorAmount,
          split.platformAmount,
          // POWR unlock marker (OP_7, no payload) — which article it unlocks
          // is attributed server-side, exactly like the article page.
          encodeFeedOpReturnRaw({ action: FEED_ACTION.UNLOCK }),
        )
      : ''
  const cashtabUrl = bip21 ? `https://cashtab.com/#/send?bip21=${bip21}` : ''

  const stop = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    if (watchRef.current) {
      watchRef.current()
      watchRef.current = null
    }
  }, [])

  // Closing the pane mid-payment stops the choreography; the payment itself
  // is safe either way — verify-payment/check-unlock grant entitlement
  // whenever they're next asked (e.g. on the story's own page).
  useEffect(() => stop, [stop])

  const succeed = useCallback(() => {
    if (doneRef.current) return
    doneRef.current = true
    stop()
    try {
      triggerPaymentSuccessEffect()
    } catch {
      /* the unlock still lands without the flourish */
    }
    try {
      // Pay doubles as login (the server minted a pay-scope session) — let
      // the topbar and anything else watching /api/me refresh itself.
      window.dispatchEvent(new CustomEvent('sessionChanged'))
    } catch {
      /* ignore */
    }
    if (onUnlocked) void onUnlocked()
  }, [stop, onUnlocked])

  const checkLatest = useCallback(async () => {
    if (doneRef.current) return
    try {
      const latestRes = await fetch(`/api/latest-tx/${encodeURIComponent(authorAddress)}`)
      const latestData = await latestRes.json().catch(() => ({}))
      const txid = latestRes.ok ? latestData.txid : ''
      if (!txid || txid === baselineRef.current || txid === handledRef.current) return
      handledRef.current = txid

      const verifyRes = await fetch('/api/verify-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txid, postId }),
      })
      const verifyData = await verifyRes.json().catch(() => ({}))

      // Seen on-chain but not Avalanche-final yet: show the interim state and
      // clear the handled ref so the next tick retries this same txid — the
      // unlock row is only written once finality lands.
      if (verifyRes.status === 202 || verifyData.finalizing) {
        setPhase('finalizing')
        handledRef.current = ''
        return
      }

      if (verifyRes.ok && verifyData.unlocked) {
        succeed()
        return
      }

      // Someone (this reader, another tab) already spent this txid on the
      // unlock — the entitlement may exist even though verify said no.
      const verifyError = String(verifyData.error || '').toLowerCase()
      if (verifyError.includes('already')) {
        const unlockRes = await fetch(`/api/check-unlock/${encodeURIComponent(postId)}`)
        const unlockData = await unlockRes.json().catch(() => ({}))
        if (unlockData.unlocked) succeed()
      }
    } catch {
      /* transient — the interval covers the next attempt */
    }
  }, [authorAddress, postId, succeed])

  const start = useCallback(async () => {
    if (!cashtabUrl) return
    // Subscribe the shared socket during the click gesture so the payment
    // can't outrun the watcher's handshake.
    prewarmPaymentWatch()
    setPhase('watching')
    // Cashtab extension if the reader has it (in-page popup, no tab), else a
    // Cashtab web tab — exactly one. If they reject in the extension popup,
    // drop back to idle instead of waiting forever.
    void payWithCashtab({ bip21, cashtabUrl }).then((res) => {
      if (!res.ok && res.reason === 'denied' && !doneRef.current) {
        stop()
        setPhase('idle')
      }
    })

    stop()
    doneRef.current = false
    handledRef.current = ''
    try {
      const res = await fetch(`/api/latest-tx/${encodeURIComponent(authorAddress)}`)
      const data = await res.json().catch(() => ({}))
      baselineRef.current = res.ok && data.txid ? data.txid : ''
    } catch {
      baselineRef.current = ''
    }
    void checkLatest()
    pollRef.current = setInterval(() => void checkLatest(), 1200)
    watchRef.current = watchPaymentAddress(
      authorAddress,
      () => void checkLatest(),
      () => void checkLatest(),
    )
  }, [cashtabUrl, authorAddress, checkLatest, stop])

  const priceLabel = `${Number(priceXec ?? 0).toLocaleString()} XEC`

  // No payout address on file (rare legacy case) — the story's own page
  // still handles it.
  if (!cashtabUrl || !postId) {
    return (
      <div className="hr-paywall">
        <p className="hr-lockline">The rest is for readers.</p>
        <Link className="hr-unlock" href={`/posts/${slug}`}>Unlock · {priceLabel}</Link>
      </div>
    )
  }

  return (
    <div className="hr-paywall">
      <p className="hr-lockline">The rest is for readers.</p>
      {phase === 'idle' ? (
        <>
          <button type="button" className="hr-unlock" onClick={() => void start()}>
            Unlock · {priceLabel}
          </button>
          <p className="hr-note">94% to the writer · 6% to the platform. The story opens right here.</p>
        </>
      ) : (
        <>
          <p className="hr-watching">
            {phase === 'finalizing'
              ? 'Payment detected — finalizing on eCash…'
              : 'Waiting for your payment…'}
          </p>
          <p className="hr-note">Approve in the Cashtab tab — this pane unlocks itself in a few seconds.</p>
          <button
            type="button"
            className="hr-cancelwait"
            onClick={() => {
              stop()
              setPhase('idle')
            }}
          >
            cancel
          </button>
        </>
      )}
    </div>
  )
}
