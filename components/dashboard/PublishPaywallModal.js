'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { triggerPaymentSuccessEffect } from '@/lib/paymentSuccessEffect'
import { buildPublishFeeBip21 } from '@/lib/paymentSplit'
import { watchPaymentAddress, prewarmPaymentWatch } from '@/lib/ecash/watchPaymentAddress'
// Pocket-aware: a funded Pocket pays the flat publish fee locally (payDirect →
// known txid, no address scan); otherwise the exact payWithCashtab behavior.
import { payDirect, spendEligibility } from '@/lib/pocket/payGateway'
import {
  getSharedAudioContext,
  primeAudioContextOnUserGesture,
} from '@/lib/webAudioUnlock'

const PUBLISH_FEE_XEC = 1000

export default function PublishPaywallModal({
  isOpen,
  onClose,
  postId,
  onPaymentConfirmed,
  onCashtabOpened,
  onPublishPaymentPollingEnded,
}) {
  const [payError, setPayError] = useState(null)
  const [waiting, setWaiting] = useState(false)
  const [opReturnRaw, setOpReturnRaw] = useState('')
  const pollRef = useRef(null)
  const watchRef = useRef(null)
  const baselineTxidRef = useRef('')
  const lastHandledTxidRef = useRef('')
  // Set when the Pocket paid the fee: the txid is KNOWN, so verification
  // targets that tx directly instead of scanning the platform address.
  const pocketTxidRef = useRef('')
  // True while a Pocket payment is in flight but its txid isn't known yet. It
  // suppresses the platform-address scan during that ~1-2s window: the shared
  // platform address is busy, and a concurrent publish landing there would trip
  // verify-publish-payment's "does not match" hard-stop and strand this one.
  const pocketExpectedRef = useRef(false)
  const publishAudioContextRef = useRef(null)
  // Fires the success chime + navigation exactly once. The poll interval and the
  // Chronik websocket can both reach the "paid" branch in the same instant; without
  // this latch each would ding and each would run onPaymentConfirmed (double publish
  // + double ding). Re-armed at the start of every pay attempt (startPublishFeePolling).
  const settledRef = useRef(false)
  // The postId whose publish envelope we've already fetched — so prefetching (below)
  // doesn't refetch on every re-render, and a switch to a new post drops the stale one.
  const preparedPostIdRef = useRef('')
  const onPaymentConfirmedRef = useRef(onPaymentConfirmed)
  const onPublishPaymentPollingEndedRef = useRef(onPublishPaymentPollingEnded)

  useEffect(() => {
    onPaymentConfirmedRef.current = onPaymentConfirmed
  }, [onPaymentConfirmed])

  useEffect(() => {
    onPublishPaymentPollingEndedRef.current = onPublishPaymentPollingEnded
  }, [onPublishPaymentPollingEnded])

  const platformAddressForLatestTx = useMemo(() => {
    const raw =
      typeof process.env.NEXT_PUBLIC_PLATFORM_XEC_ADDRESS === 'string'
        ? process.env.NEXT_PUBLIC_PLATFORM_XEC_ADDRESS.trim()
        : ''
    if (!raw) return ''
    const stripped = raw.replace(/^ecash:/i, '').trim()
    return stripped ? `ecash:${stripped}` : ''
  }, [])

  // Fetch the POWR publish envelope (OP_6) from the server, which hashes the
  // canonical stored body so the on-chain contentHash always matches what the
  // verify route recomputes. Runs as soon as we have a postId — the form sets it
  // BEFORE it flips the modal open, so the envelope is usually in hand by the time
  // the dialog paints and the Pay button is lit on first frame (no "off then on"
  // flicker). The [isOpen] dep keeps a retry path: if the prefetch is still in
  // flight (or failed) when the modal opens, this re-runs and fetches once more.
  useEffect(() => {
    if (!postId) {
      setOpReturnRaw('')
      preparedPostIdRef.current = ''
      return
    }
    // Already have this post's envelope (from the prefetch) — don't refetch on the
    // modal-open re-render; the button is already lit and the value is current.
    if (preparedPostIdRef.current === postId) return
    let alive = true
    void (async () => {
      try {
        const res = await fetch(
          `/api/publish/prepare?postId=${encodeURIComponent(postId)}`,
          { credentials: 'include' },
        )
        const data = await res.json().catch(() => ({}))
        if (!alive) return
        if (res.ok && data.opReturnRaw) {
          preparedPostIdRef.current = postId
          setOpReturnRaw(data.opReturnRaw)
          setPayError(null)
        } else {
          setOpReturnRaw('')
          setPayError(
            data.error || 'Publishing is temporarily unavailable, please contact support.',
          )
        }
      } catch {
        if (alive) setOpReturnRaw('')
      }
    })()
    return () => {
      alive = false
    }
  }, [isOpen, postId])

  const publishFeeBip21Url = useMemo(() => {
    if (!platformAddressForLatestTx || !opReturnRaw) return ''
    try {
      return buildPublishFeeBip21(
        platformAddressForLatestTx,
        PUBLISH_FEE_XEC,
        opReturnRaw,
      )
    } catch {
      return ''
    }
  }, [platformAddressForLatestTx, opReturnRaw])

  const publishFeeCashtabUrl = useMemo(
    () =>
      publishFeeBip21Url
        ? `https://cashtab.com/#/send?bip21=${publishFeeBip21Url}`
        : '',
    [publishFeeBip21Url],
  )

  const stopPublishFeePolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    if (watchRef.current) {
      watchRef.current()
      watchRef.current = null
    }
    baselineTxidRef.current = ''
    lastHandledTxidRef.current = ''
    pocketExpectedRef.current = false
  }, [])

  useEffect(() => {
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
      if (watchRef.current) {
        watchRef.current()
        watchRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!isOpen) {
      stopPublishFeePolling()
      setWaiting(false)
      // Drop the prepared envelope on close so re-publishing the same draft — whose
      // body may have been edited in between — refetches a fresh content hash rather
      // than paying against a stale one. The common first-publish path is untouched:
      // the envelope is only cleared once the dialog actually closes.
      setOpReturnRaw('')
      preparedPostIdRef.current = ''
    }
  }, [isOpen, stopPublishFeePolling])

  useEffect(() => {
    if (isOpen) {
      setPayError(null)
      setWaiting(false)
    }
  }, [isOpen, postId])

  const startPublishFeePolling = useCallback(() => {
    if (!postId || !platformAddressForLatestTx) return

    // Fresh attempt: re-arm the settle latch so this payment's success can fire.
    settledRef.current = false

    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }

    void (async () => {
      try {
        const baselineRes = await fetch(
          `/api/latest-tx/${encodeURIComponent(platformAddressForLatestTx)}`,
        )
        const baselineData = await baselineRes.json().catch(() => ({}))
        baselineTxidRef.current =
          baselineRes.ok && baselineData.txid ? baselineData.txid : ''
      } catch {
        baselineTxidRef.current = ''
      }
    })()

    const checkLatest = async () => {
      try {
        // Pocket-paid: the txid is known — verify it directly, skip the scan.
        let latestTxid = pocketTxidRef.current
        if (!latestTxid) {
          // A Pocket payment is in flight but hasn't returned its txid yet —
          // wait for it. Scanning the shared platform address here could pick
          // up a concurrent publish and hard-stop on "does not match"; the
          // Pocket path always hands us the exact txid a moment later.
          if (pocketExpectedRef.current) return
          const latestTxRes = await fetch(
            `/api/latest-tx/${encodeURIComponent(platformAddressForLatestTx)}`,
          )
          const latestTxData = await latestTxRes.json().catch(() => ({}))
          latestTxid = latestTxRes.ok ? latestTxData.txid : ''
          if (!latestTxid) return
          if (latestTxid === baselineTxidRef.current) return
          if (latestTxid === lastHandledTxidRef.current) return
          lastHandledTxidRef.current = latestTxid
        }

        const verifyRes = await fetch('/api/verify-publish-payment', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ txid: latestTxid, postId }),
        })
        const verifyData = await verifyRes.json().catch(() => ({}))

        if (verifyRes.ok && (verifyData.paid === true || verifyData.already_paid === true)) {
          // Settle exactly once. The 1.2s poll tick and the Chronik websocket can
          // both reach this branch in the same instant; the latch stops the second
          // from dinging again and running a duplicate publish + navigation.
          if (settledRef.current) return
          settledRef.current = true
          stopPublishFeePolling()
          try {
            sessionStorage.removeItem('pollingActive')
          } catch {
            /* ignore */
          }
          setPayError(null)
          // Chime the instant the payment confirms — the money landing is what the
          // sound celebrates — then run the publish + navigation. Firing before the
          // await keeps the feedback immediate instead of trailing the persist call.
          triggerPaymentSuccessEffect(publishAudioContextRef.current ?? undefined)
          try {
            await Promise.resolve(onPaymentConfirmedRef.current?.())
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Could not complete publish.'
            setPayError(msg)
            onPublishPaymentPollingEndedRef.current?.()
          } finally {
            setWaiting(false)
          }
          return
        }

        if (verifyRes.status === 400) {
          const err = String(verifyData.error || '')
          const errLower = err.toLowerCase()
          if (errLower.includes('already used')) {
            stopPublishFeePolling()
            setPayError(err || 'This transaction was already used.')
            setWaiting(false)
            onPublishPaymentPollingEndedRef.current?.()
            return
          }
          if (
            errLower.includes('does not match') ||
            errLower.includes('forbidden') ||
            errLower.includes('unauthorized')
          ) {
            stopPublishFeePolling()
            setPayError(err)
            setWaiting(false)
            onPublishPaymentPollingEndedRef.current?.()
            return
          }
          return
        }

        if (verifyRes.status === 401 || verifyRes.status === 403) {
          stopPublishFeePolling()
          setPayError(verifyData.error || 'Not authorized.')
          setWaiting(false)
          onPublishPaymentPollingEndedRef.current?.()
          return
        }
        if (verifyRes.status === 404) {
          stopPublishFeePolling()
          setPayError(verifyData.error || 'Post not found.')
          setWaiting(false)
          onPublishPaymentPollingEndedRef.current?.()
          return
        }
      } catch {
        /* keep polling */
      }
    }

    void checkLatest()
    pollRef.current = setInterval(() => {
      void checkLatest()
    }, 1200)
    // Live nudge: a Chronik websocket on the platform address fires an immediate
    // check the instant a payment lands there, instead of waiting up to 3s for
    // the next tick. checkLatest still baselines + verifies server-side, so an
    // unrelated platform tx just costs one harmless check.
    if (watchRef.current) watchRef.current()
    watchRef.current = watchPaymentAddress(
      platformAddressForLatestTx,
      () => { void checkLatest() },
      // Wake (tab back to foreground / ws reconnect): the fee payment may have
      // broadcast while this tab was suspended — check now, don't wait a tick.
      () => { void checkLatest() },
    )
  }, [platformAddressForLatestTx, postId, stopPublishFeePolling])

  function openPublishCashtab() {
    if (!publishFeeCashtabUrl || typeof window === 'undefined') return
    try {
      sessionStorage.setItem('pollingActive', 'true')
    } catch {
      /* ignore */
    }
    pocketTxidRef.current = ''
    // Decide synchronously (before the async pay) whether the Pocket will take
    // this — if so, the verify loop must WAIT for the Pocket's txid instead of
    // scanning the shared platform address. Same eligibility check payDirect
    // runs internally, so the two never disagree.
    pocketExpectedRef.current = spendEligibility('publish', PUBLISH_FEE_XEC).eligible
    // Pocket if it can cover the flat fee (signs locally; .then hands us the
    // txid), else Cashtab extension popup or web tab — exactly one. Rejecting
    // in the extension popup drops back out of the waiting state.
    void payDirect({
      kind: 'publish',
      amountXec: PUBLISH_FEE_XEC,
      bip21: publishFeeBip21Url,
      cashtabUrl: publishFeeCashtabUrl,
    }).then((res) => {
      if (res.ok && res.via === 'pocket' && res.txid) {
        // Known txid: the verify loop targets it directly from now on.
        pocketTxidRef.current = res.txid
        return
      }
      // The Pocket is NOT handling this payment (fell through to Cashtab,
      // failed, or was denied) — resume the address scan so a Cashtab payment
      // still gets detected.
      pocketExpectedRef.current = false
      if (!res.ok && res.reason === 'denied') {
        stopPublishFeePolling()
        setWaiting(false)
        try {
          sessionStorage.removeItem('pollingActive')
        } catch {
          /* ignore */
        }
      } else if (!res.ok && res.reason === 'pocket_error') {
        // Keep the waiting UI (its manual Cashtab link still completes the
        // payment); surface why the silent path didn't run.
        setPayError(res.message || 'Pocket couldn’t send — pay with Cashtab instead.')
      }
    })
    onCashtabOpened?.()
  }

  function handlePublishPaywallPay() {
    setPayError(null)
    if (!publishFeeCashtabUrl) {
      setPayError(
        'Publishing is temporarily unavailable, please contact support.',
      )
      return
    }
    // Warm the shared payment socket at the click so it's subscribed before the
    // publish-fee payment lands — this flow polls every 3s, so a missed push is
    // the most costly. Publish-fee is confirmed at 0-conf (no finality gate), so
    // detection speed is what the author feels.
    prewarmPaymentWatch()
    if (typeof window !== 'undefined') {
      const ctx = getSharedAudioContext()
      publishAudioContextRef.current = ctx
      if (ctx) {
        void primeAudioContextOnUserGesture(ctx)
      }
    }
    openPublishCashtab()
    startPublishFeePolling()
    setWaiting(true)
  }

  function handlePublishPaywallCancel() {
    stopPublishFeePolling()
    setPayError(null)
    setWaiting(false)
    try {
      sessionStorage.removeItem('pollingActive')
    } catch {
      /* ignore */
    }
    onClose()
  }

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!isOpen || !platformAddressForLatestTx) return
    try {
      if (sessionStorage.getItem('pollingActive') === 'true') {
        sessionStorage.removeItem('pollingActive')
        startPublishFeePolling()
      }
    } catch {
      /* ignore */
    }
  }, [isOpen, platformAddressForLatestTx, startPublishFeePolling])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="publish-paywall-title"
    >
      <div className="max-h-[90vh] w-auto inline-block max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-[#e3dfd2] bg-[#fdfcf8] p-6 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
        <h2
          id="publish-paywall-title"
          className="text-lg font-semibold text-[#1a1c17] dark:text-zinc-50"
        >
          Pay to publish
        </h2>
        {waiting ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#e3dfd2] border-t-[#3a3d33] dark:border-zinc-600 dark:border-t-zinc-200" />
            <p className="text-sm font-medium text-[#3a3d33] dark:text-zinc-300">Waiting for payment...</p>
            <p className="text-xs text-[#5e6155] dark:text-zinc-400">
              Complete the payment in Cashtab to publish your post.
            </p>
          </div>
        ) : (
          <>
            <p className="mt-3 text-sm leading-relaxed text-[#5e6155] dark:text-zinc-400">
              Publishing costs {PUBLISH_FEE_XEC.toLocaleString()} XEC to help prevent
              <span className="hidden sm:inline">
                <br />
              </span>{' '}
              spam and keep the platform sustainable.
            </p>
            {!platformAddressForLatestTx ? (
              <p className="mt-4 text-sm text-red-600 dark:text-red-400" role="alert">
                Publishing is temporarily unavailable, please contact support.
              </p>
            ) : null}
            {payError ? (
              <p className="mt-3 text-sm text-red-600 dark:text-red-400" role="alert">
                {payError}
              </p>
            ) : null}
          </>
        )}
        <div className="mt-6 flex flex-row items-center gap-2 whitespace-nowrap">
          {!waiting ? (
            <button
              type="button"
              onClick={handlePublishPaywallPay}
              disabled={!publishFeeCashtabUrl}
              className="rounded-lg bg-[#12703c] px-4 py-2.5 text-sm font-semibold text-[#fdfcf8] shadow-sm transition hover:bg-[#0d5a2f] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-emerald-500 dark:text-emerald-950 dark:hover:bg-emerald-400"
            >
              Pay {PUBLISH_FEE_XEC.toLocaleString()} XEC to publish
            </button>
          ) : null}
          <button
            type="button"
            onClick={handlePublishPaywallCancel}
            className="rounded-lg border border-[#e3dfd2] bg-[#fdfcf8] px-4 py-2.5 text-sm font-medium text-[#1a1c17] transition hover:bg-[#f1eee4] dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
