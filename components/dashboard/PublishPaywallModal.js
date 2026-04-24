'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { encodePostIdOpReturnRaw } from '@/lib/opReturnEncode'
import { triggerPaymentSuccessEffect } from '@/lib/paymentSuccessEffect'
import { buildPublishFeeBip21 } from '@/lib/paymentSplit'
import {
  getSharedAudioContext,
  primeAudioContextOnUserGesture,
} from '@/lib/webAudioUnlock'

const PUBLISH_FEE_XEC = 100

export default function PublishPaywallModal({
  isOpen,
  onClose,
  postId,
  onPaymentConfirmed,
}) {
  const [payError, setPayError] = useState(null)
  const pollRef = useRef(null)
  const baselineTxidRef = useRef('')
  const lastHandledTxidRef = useRef('')
  const publishAudioContextRef = useRef(null)
  const onPaymentConfirmedRef = useRef(onPaymentConfirmed)

  useEffect(() => {
    onPaymentConfirmedRef.current = onPaymentConfirmed
  }, [onPaymentConfirmed])

  const platformAddressForLatestTx = useMemo(() => {
    const raw =
      typeof process.env.NEXT_PUBLIC_PLATFORM_XEC_ADDRESS === 'string'
        ? process.env.NEXT_PUBLIC_PLATFORM_XEC_ADDRESS.trim()
        : ''
    if (!raw) return ''
    const stripped = raw.replace(/^ecash:/i, '').trim()
    return stripped ? `ecash:${stripped}` : ''
  }, [])

  const publishFeeBip21Url = useMemo(() => {
    if (!platformAddressForLatestTx || !postId) return ''
    try {
      const opReturnRaw = encodePostIdOpReturnRaw(postId)
      return buildPublishFeeBip21(
        platformAddressForLatestTx,
        PUBLISH_FEE_XEC,
        opReturnRaw,
      )
    } catch {
      return ''
    }
  }, [platformAddressForLatestTx, postId])

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
    baselineTxidRef.current = ''
    lastHandledTxidRef.current = ''
  }, [])

  useEffect(() => {
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!isOpen) {
      stopPublishFeePolling()
    }
  }, [isOpen, stopPublishFeePolling])

  useEffect(() => {
    if (isOpen) {
      setPayError(null)
    }
  }, [isOpen, postId])

  const startPublishFeePolling = useCallback(() => {
    if (!postId || !platformAddressForLatestTx) return

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
        const latestTxRes = await fetch(
          `/api/latest-tx/${encodeURIComponent(platformAddressForLatestTx)}`,
        )
        const latestTxData = await latestTxRes.json().catch(() => ({}))
        const latestTxid = latestTxRes.ok ? latestTxData.txid : ''
        if (!latestTxid) return
        if (latestTxid === baselineTxidRef.current) return
        if (latestTxid === lastHandledTxidRef.current) return
        lastHandledTxidRef.current = latestTxid

        const verifyRes = await fetch('/api/verify-publish-payment', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ txid: latestTxid, postId }),
        })
        const verifyData = await verifyRes.json().catch(() => ({}))

        if (verifyRes.ok && (verifyData.paid === true || verifyData.already_paid === true)) {
          stopPublishFeePolling()
          try {
            sessionStorage.removeItem('pollingActive')
          } catch {
            /* ignore */
          }
          setPayError(null)
          try {
            await Promise.resolve(onPaymentConfirmedRef.current?.())
            triggerPaymentSuccessEffect(publishAudioContextRef.current ?? undefined)
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Could not complete publish.'
            setPayError(msg)
          }
          return
        }

        if (verifyRes.status === 400) {
          const err = String(verifyData.error || '')
          const errLower = err.toLowerCase()
          if (errLower.includes('already used')) {
            stopPublishFeePolling()
            setPayError(err || 'This transaction was already used.')
            return
          }
          if (
            errLower.includes('does not match') ||
            errLower.includes('forbidden') ||
            errLower.includes('unauthorized')
          ) {
            stopPublishFeePolling()
            setPayError(err)
            return
          }
          return
        }

        if (verifyRes.status === 401 || verifyRes.status === 403) {
          stopPublishFeePolling()
          setPayError(verifyData.error || 'Not authorized.')
          return
        }
        if (verifyRes.status === 404) {
          stopPublishFeePolling()
          setPayError(verifyData.error || 'Post not found.')
          return
        }
      } catch {
        /* keep polling */
      }
    }

    void checkLatest()
    pollRef.current = setInterval(() => {
      void checkLatest()
    }, 3000)
  }, [platformAddressForLatestTx, postId, stopPublishFeePolling])

  function openPublishCashtab(url) {
    if (!url || typeof window === 'undefined') return
    try {
      sessionStorage.setItem('pollingActive', 'true')
    } catch {
      /* ignore */
    }
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  function handlePublishPaywallPay() {
    setPayError(null)
    if (!publishFeeCashtabUrl) {
      setPayError(
        'Publishing is temporarily unavailable, please contact support.',
      )
      return
    }
    if (typeof window !== 'undefined') {
      const ctx = getSharedAudioContext()
      publishAudioContextRef.current = ctx
      if (ctx) {
        void primeAudioContextOnUserGesture(ctx)
      }
    }
    openPublishCashtab(publishFeeCashtabUrl)
    startPublishFeePolling()
  }

  function handlePublishPaywallCancel() {
    stopPublishFeePolling()
    setPayError(null)
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
      <div className="max-h-[90vh] w-auto inline-block max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
        <h2
          id="publish-paywall-title"
          className="text-lg font-semibold text-zinc-900 dark:text-zinc-50"
        >
          Pay to publish
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          Publishing costs 100 XEC to help prevent
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
        <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-500">
          Don&apos;t have 100 XEC?{' '}
          <Link
            href="/how-it-works"
            className="font-medium text-emerald-700 underline hover:text-emerald-800 dark:text-emerald-400"
          >
            Get eCash
          </Link>
        </p>
        <div className="mt-6 flex flex-row items-center gap-2 whitespace-nowrap">
          <button
            type="button"
            onClick={handlePublishPaywallPay}
            disabled={!publishFeeCashtabUrl}
            className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-emerald-500 dark:text-emerald-950 dark:hover:bg-emerald-400"
          >
            Pay 100 XEC to publish
          </button>
          <button
            type="button"
            onClick={handlePublishPaywallCancel}
            className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
