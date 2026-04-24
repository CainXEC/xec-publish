'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { encodePostIdOpReturnRaw } from '@/lib/opReturnEncode'
import { triggerPaymentSuccessEffect } from '@/lib/paymentSuccessEffect'
import { buildPublishFeeBip21 } from '@/lib/paymentSplit'
import {
  getAudioPriceForPost,
  getPlainTextCharCount,
  XEC_PER_CHARACTER,
} from '@/lib/audioPricing'
import {
  getSharedAudioContext,
  primeAudioContextOnUserGesture,
} from '@/lib/webAudioUnlock'

const TXID_ALREADY_USED_MESSAGE =
  "This payment has already been used. If you're trying to regenerate, make a new payment."

export default function AudioPaywallModal({
  open,
  onClose,
  post,
  onAudioGenerated,
  mode = 'add',
}) {
  const [payError, setPayError] = useState(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const pollRef = useRef(null)
  const baselineTxidRef = useRef('')
  const lastHandledTxidRef = useRef('')
  const audioContextRef = useRef(null)
  const onAudioGeneratedRef = useRef(onAudioGenerated)

  useEffect(() => {
    onAudioGeneratedRef.current = onAudioGenerated
  }, [onAudioGenerated])

  const postId = post?.id ?? ''
  const plainCharCount = useMemo(
    () => getPlainTextCharCount(post?.body ?? ''),
    [post?.body],
  )
  const audioPriceXec = useMemo(
    () => getAudioPriceForPost(plainCharCount),
    [plainCharCount],
  )

  const platformAddressForLatestTx = useMemo(() => {
    const raw =
      typeof process.env.NEXT_PUBLIC_PLATFORM_XEC_ADDRESS === 'string'
        ? process.env.NEXT_PUBLIC_PLATFORM_XEC_ADDRESS.trim()
        : ''
    if (!raw) return ''
    const stripped = raw.replace(/^ecash:/i, '').trim()
    return stripped ? `ecash:${stripped}` : ''
  }, [])

  const audioFeeBip21Url = useMemo(() => {
    if (!platformAddressForLatestTx || !postId) return ''
    try {
      const opReturnRaw = encodePostIdOpReturnRaw(postId)
      return buildPublishFeeBip21(
        platformAddressForLatestTx,
        audioPriceXec,
        opReturnRaw,
      )
    } catch {
      return ''
    }
  }, [audioPriceXec, platformAddressForLatestTx, postId])

  const audioFeeCashtabUrl = useMemo(
    () =>
      audioFeeBip21Url
        ? `https://cashtab.com/#/send?bip21=${audioFeeBip21Url}`
        : '',
    [audioFeeBip21Url],
  )

  const stopPolling = useCallback(() => {
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
    if (!open) {
      stopPolling()
      setIsGenerating(false)
    }
  }, [open, stopPolling])

  useEffect(() => {
    if (open) {
      setPayError(null)
      setIsGenerating(false)
    }
  }, [open, postId])

  const startPolling = useCallback(() => {
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
      if (isGenerating) return
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

        const verifyRes = await fetch('/api/verify-audio-payment', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ txid: latestTxid, post_id: postId }),
        })
        const verifyData = await verifyRes.json().catch(() => ({}))

        if (verifyRes.status === 409 && verifyData?.error === 'txid_already_used') {
          stopPolling()
          setPayError(TXID_ALREADY_USED_MESSAGE)
          return
        }

        if (verifyRes.ok && (verifyData.paid === true || verifyData.already_paid === true)) {
          stopPolling()
          setPayError(null)
          setIsGenerating(true)
          try {
            const generateRes = await fetch('/api/audio/generate', {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ post_id: postId, payment_txid: latestTxid }),
            })
            const generateData = await generateRes.json().catch(() => ({}))
            if (!generateRes.ok) {
              if (generateData?.error === 'txid_already_used') {
                setPayError(TXID_ALREADY_USED_MESSAGE)
              } else if (generateData?.error === 'post_too_long') {
                setPayError(
                  String(generateData?.detail) ||
                    'This post is too long for audio narration (character limit: 100,000).',
                )
              } else if (generateRes.status === 402) {
                setPayError('Payment could not be verified. Please try again.')
              } else {
                setPayError(
                  String(generateData?.detail || generateData?.error || 'Audio generation failed. Please try again.'),
                )
              }
              setIsGenerating(false)
              return
            }
            triggerPaymentSuccessEffect(audioContextRef.current ?? undefined)
            await Promise.resolve(onAudioGeneratedRef.current?.(generateData.audio_url ?? null))
            setIsGenerating(false)
            onClose()
          } catch (err) {
            setPayError(err instanceof Error ? err.message : 'Audio generation failed.')
            setIsGenerating(false)
          }
          return
        }

        if (verifyRes.status >= 400 && verifyRes.status < 500) {
          const err = String(verifyData.error || '')
          if (err.toLowerCase().includes('already used')) {
            stopPolling()
            setPayError(err || 'This transaction was already used.')
          }
        }
      } catch {
        /* keep polling */
      }
    }

    void checkLatest()
    pollRef.current = setInterval(() => {
      void checkLatest()
    }, 2000)
  }, [isGenerating, onClose, platformAddressForLatestTx, postId, stopPolling])

  function openCashtab(url) {
    if (!url || typeof window === 'undefined') return
    try {
      sessionStorage.setItem('audioPollingActive', 'true')
    } catch {
      /* ignore */
    }
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  function handlePayAudio() {
    setPayError(null)
    if (!audioFeeCashtabUrl) {
      setPayError(
        'Audio generation is temporarily unavailable, please contact support.',
      )
      return
    }
    if (typeof window !== 'undefined') {
      const ctx = getSharedAudioContext()
      audioContextRef.current = ctx
      if (ctx) {
        void primeAudioContextOnUserGesture(ctx)
      }
    }
    openCashtab(audioFeeCashtabUrl)
    startPolling()
  }

  function handleCancel() {
    stopPolling()
    setPayError(null)
    setIsGenerating(false)
    try {
      sessionStorage.removeItem('audioPollingActive')
    } catch {
      /* ignore */
    }
    onClose()
  }

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!open || !platformAddressForLatestTx) return
    try {
      if (sessionStorage.getItem('audioPollingActive') === 'true') {
        sessionStorage.removeItem('audioPollingActive')
        startPolling()
      }
    } catch {
      /* ignore */
    }
  }, [open, platformAddressForLatestTx, startPolling])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="audio-paywall-title"
    >
      <div className="max-h-[90vh] w-auto inline-block max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
        <h2
          id="audio-paywall-title"
          className="text-lg font-semibold text-zinc-900 dark:text-zinc-50"
        >
          {mode === 'regenerate' ? 'Regenerate AI audio' : 'Add AI audio'}
        </h2>
        {mode === 'regenerate' ? (
          <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            You&apos;ve edited this article. The existing audio is from a previous version. Regenerate the audio now to
            match your updated post.
            <br />
            Cost: {audioPriceXec} XEC (based on current article length)
            <br />
            One-time payment. The new audio will replace the previous one.
          </p>
        ) : (
          <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            Generate an AI voice narration of this article.
            <br />
            Cost: {audioPriceXec.toLocaleString('en-US')} XEC (based on current article length)
            <br />
            One-time payment. Audio becomes available to readers who unlock your post.
          </p>
        )}
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-500">
          ({plainCharCount.toLocaleString('en-US')} characters × {XEC_PER_CHARACTER} XEC = {audioPriceXec.toLocaleString('en-US')} XEC)
        </p>
        {!platformAddressForLatestTx ? (
          <p className="mt-4 text-sm text-red-600 dark:text-red-400" role="alert">
            Audio generation is temporarily unavailable, please contact support.
          </p>
        ) : null}
        {payError ? (
          <p className="mt-3 text-sm text-red-600 dark:text-red-400" role="alert">
            {payError}
          </p>
        ) : null}
        {isGenerating ? (
          <div className="mt-4 rounded-lg border border-zinc-200 bg-white/70 px-4 py-3 dark:border-zinc-700 dark:bg-zinc-900/60">
            <div className="flex items-center gap-3">
              <span
                aria-hidden
                className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-emerald-500 dark:border-zinc-600 dark:border-t-emerald-400"
              />
              <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                Generating audio...
              </p>
            </div>
          </div>
        ) : null}
        <div className="mt-6 flex flex-row items-center gap-2 whitespace-nowrap">
          <button
            type="button"
            onClick={handlePayAudio}
            disabled={!audioFeeCashtabUrl || isGenerating}
            className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-emerald-500 dark:text-emerald-950 dark:hover:bg-emerald-400"
          >
            {mode === 'regenerate'
              ? `Pay ${audioPriceXec} XEC to regenerate`
              : `Pay ${audioPriceXec} XEC for audio`}
          </button>
          <button
            type="button"
            onClick={handleCancel}
            disabled={isGenerating}
            className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-800 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
