'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CashtabAddressDeniedError,
  CashtabConnect,
  CashtabExtensionUnavailableError,
  CashtabTimeoutError,
} from 'cashtab-connect'
import { buildPaywallBip21, computePaymentSplit } from '@/lib/paymentSplit'
import { supabase } from '@/lib/supabase'
import PaymentQrCode from './PaymentQrCode'

const CASHTAB_CHROME_STORE_URL =
  'https://chromewebstore.google.com/detail/cashtab/obldfcmebhllhjlhjbnghaipekcppeag'

export default function PublicPostPage() {
  const params = useParams()
  const slug = params?.slug

  const cashtabRef = useRef(null)

  function getCashtab() {
    if (typeof window === 'undefined') return null
    if (!cashtabRef.current) {
      cashtabRef.current = new CashtabConnect(30000)
    }
    return cashtabRef.current
  }

  const [post, setPost] = useState(null)
  const [author, setAuthor] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [loadingPost, setLoadingPost] = useState(true)

  const [unlocked, setUnlocked] = useState(false)
  const [unlockCheckPending, setUnlockCheckPending] = useState(true)

  const [pollingActive, setPollingActive] = useState(false)
  const pollRef = useRef(null)

  const [txidInput, setTxidInput] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [verifyError, setVerifyError] = useState(null)

  const [connectBusy, setConnectBusy] = useState(false)
  const [walletNotPaidMessage, setWalletNotPaidMessage] = useState(false)
  const [extensionMissing, setExtensionMissing] = useState(false)
  const [connectOtherError, setConnectOtherError] = useState(null)

  const [payBusy, setPayBusy] = useState(false)

  useEffect(() => {
    if (!slug) return

    let cancelled = false

    async function load() {
      setLoadingPost(true)
      setLoadError(null)

      const { data: postRow, error: postError } = await supabase
        .from('posts')
        .select('id, author_id, title, teaser, body, price_xec, published, slug')
        .eq('slug', slug)
        .eq('published', true)
        .maybeSingle()

      if (cancelled) return

      if (postError || !postRow) {
        setLoadError(postError?.message || 'not_found')
        setLoadingPost(false)
        return
      }

      const { data: authorRow } = await supabase
        .from('authors')
        .select('username, xec_address')
        .eq('id', postRow.author_id)
        .maybeSingle()

      if (cancelled) return

      setPost(postRow)
      setAuthor(authorRow ?? null)
      setLoadingPost(false)
    }

    load()

    return () => {
      cancelled = true
    }
  }, [slug])

  const checkUnlock = useCallback(async (postId, walletAddress) => {
    const url = walletAddress
      ? `/api/check-unlock/${encodeURIComponent(postId)}?walletAddress=${encodeURIComponent(walletAddress)}`
      : `/api/check-unlock/${encodeURIComponent(postId)}`
    const res = await fetch(url)
    const data = await res.json().catch(() => ({}))
    if (data.unlocked) {
      setUnlocked(true)
      setPollingActive(false)
      return true
    }
    return false
  }, [])

  useEffect(() => {
    if (!post?.id) return

    let cancelled = false

    async function initialUnlock() {
      setUnlockCheckPending(true)
      let ok = await checkUnlock(post.id)
      if (!ok && typeof window !== 'undefined') {
        const stored = localStorage.getItem('walletAddress')
        if (stored?.trim()) {
          ok = await checkUnlock(post.id, stored.trim())
        }
      }
      if (!cancelled) setUnlockCheckPending(false)
    }

    initialUnlock()

    return () => {
      cancelled = true
    }
  }, [post?.id, checkUnlock])

  useEffect(() => {
    if (!pollingActive || !post?.id || unlocked) return

    pollRef.current = setInterval(() => {
      checkUnlock(post.id)
    }, 2000)

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [pollingActive, post?.id, unlocked, checkUnlock])

  useEffect(() => {
    if (unlocked || unlockCheckPending || !post?.id) return undefined

    const addr = (author?.xec_address ?? '').replace(/^ecash:/, '')
    if (!addr) return undefined

    const es = new EventSource(`/api/watch-payment/${encodeURIComponent(post.id)}`)

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.unlocked === true) {
          setUnlocked(true)
          setPollingActive(false)
          es.close()
        }
      } catch {
        /* ignore malformed SSE payloads */
      }
    }

    es.onerror = () => {
      es.close()
    }

    return () => {
      es.close()
    }
  }, [post?.id, author?.xec_address, unlocked, unlockCheckPending])

  const formatXecAmount = (amount) => {
    if (!Number.isFinite(amount)) return '0'
    return amount.toFixed(8).replace(/\.?0+$/, '')
  }

  const priceXec = Number(post?.price_xec ?? 0)
  const authorXecAddress = (author?.xec_address ?? '').replace(/^ecash:/, '')
  const platformXecAddress =
    typeof process.env.NEXT_PUBLIC_PLATFORM_XEC_ADDRESS === 'string'
      ? process.env.NEXT_PUBLIC_PLATFORM_XEC_ADDRESS.trim()
      : ''
  const paymentSplit = post ? computePaymentSplit(post.price_xec) : null
  const authorAddrForBip21 =
    author?.xec_address?.trim() ||
    (authorXecAddress ? `ecash:${authorXecAddress}` : '')
  const bip21Url =
    authorAddrForBip21 &&
    platformXecAddress &&
    post &&
    paymentSplit
      ? buildPaywallBip21(
          authorAddrForBip21,
          platformXecAddress,
          paymentSplit.authorAmount,
          paymentSplit.platformAmount,
        )
      : ''
  const cashtabUrl = bip21Url
    ? `https://cashtab.com/#/send?bip21=${bip21Url}`
    : ''
  const unlockPriceLabel = formatXecAmount(priceXec)

  async function handleVerifyTxid(e) {
    e.preventDefault()
    if (!post?.id || !txidInput.trim()) return

    setVerifyError(null)
    setVerifying(true)

    try {
      const res = await fetch('/api/verify-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txid: txidInput.trim(), postId: post.id }),
      })
      const data = await res.json().catch(() => ({}))

      if (res.ok && data.unlocked) {
        setUnlocked(true)
        setPollingActive(false)
        setTxidInput('')
      } else {
        setVerifyError(data.error || 'Verification failed')
      }
    } catch (err) {
      setVerifyError(err?.message || 'Verification failed')
    } finally {
      setVerifying(false)
    }
  }

  async function handleConnectCashtabWallet() {
    const cashtab = getCashtab()
    if (!post?.id || !cashtab) return

    setConnectBusy(true)
    setWalletNotPaidMessage(false)
    setExtensionMissing(false)
    setConnectOtherError(null)

    try {
      await cashtab.waitForExtension()
      const address = await cashtab.requestAddress()
      if (address) {
        localStorage.setItem('walletAddress', address)
      }
      const ok = await checkUnlock(post.id, address)
      if (!ok) {
        setWalletNotPaidMessage(true)
      }
    } catch (err) {
      if (err instanceof CashtabExtensionUnavailableError) {
        setExtensionMissing(true)
      } else if (err instanceof CashtabAddressDeniedError) {
        setConnectOtherError(err.message || 'Address request was denied.')
      } else if (err instanceof CashtabTimeoutError) {
        setConnectOtherError('Request timed out. Please try again.')
      } else if (err instanceof Error) {
        setConnectOtherError(err.message)
      } else {
        setConnectOtherError('Could not connect to Cashtab.')
      }
    } finally {
      setConnectBusy(false)
    }
  }

  async function handlePayToUnlock() {
    if (!post || !bip21Url || !cashtabUrl) return

    setPollingActive(true)
    setPayBusy(true)
    const cashtab = getCashtab()

    const isMobile =
      typeof window !== 'undefined' &&
      ('ontouchstart' in window || navigator.maxTouchPoints > 0)

    // On mobile, navigate immediately in the same tap call stack.
    if (isMobile) {
      window.location.href = cashtabUrl
      return
    }

    const openCashtabWeb = () => {
      window.open(cashtabUrl, '_blank', 'noopener,noreferrer')
    }

    try {
      if (!cashtab) {
        openCashtabWeb()
        return
      }

      const extensionAvailabilityPromise = cashtab.isExtensionAvailable()

      try {
        const extensionAvailable = await extensionAvailabilityPromise
        if (!extensionAvailable) {
          openCashtabWeb()
          return
        }
        await cashtab.waitForExtension(500)
      } catch {
        openCashtabWeb()
        return
      }

      await cashtab.sendBip21(bip21Url)
    } catch {
      /* User cancelled send in the extension or send failed — extension was available, do not open web */
    } finally {
      setPayBusy(false)
    }
  }

  if (loadingPost) {
    return (
      <div className="flex min-h-full flex-1 items-center justify-center bg-zinc-50 px-4 py-16 dark:bg-zinc-950">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Loading post...</p>
      </div>
    )
  }

  if (loadError || !post) {
    return (
      <div className="flex min-h-full flex-1 items-center justify-center bg-zinc-50 px-4 py-16 dark:bg-zinc-950">
        <div className="w-full max-w-2xl rounded-xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">404 - Post not found</h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            This post does not exist or is not published yet.
          </p>
          <Link href="/" className="mt-5 inline-block text-sm font-medium text-zinc-900 underline dark:text-zinc-200">
            Back to home
          </Link>
        </div>
      </div>
    )
  }

  const showPaywall = !unlocked && !unlockCheckPending

  return (
    <div className="flex min-h-full flex-1 flex-col bg-zinc-50 px-4 py-10 dark:bg-zinc-950">
      <main className="mx-auto w-full max-w-3xl">
        <article className="rounded-xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <Link
            href="/"
            className="mb-4 inline-block text-sm font-medium text-emerald-700 underline-offset-4 hover:underline dark:text-emerald-400"
          >
            ← Back to home
          </Link>
          <h1 className="text-3xl font-semibold leading-tight text-zinc-900 dark:text-zinc-50">
            {post.title}
          </h1>
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
            By{' '}
            {author?.username?.trim() ? (
              <Link
                href={`/u/${encodeURIComponent(author.username.trim())}`}
                className="font-medium text-zinc-800 underline-offset-2 hover:text-zinc-950 hover:underline dark:text-zinc-200 dark:hover:text-zinc-50"
              >
                {author.username.trim()}
              </Link>
            ) : (
              'Unknown author'
            )}
          </p>

          <section className="mt-8">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Preview
            </h2>
            <p className="mt-2 whitespace-pre-wrap text-base leading-7 text-zinc-800 dark:text-zinc-200">
              {post.teaser}
            </p>
          </section>

          {unlockCheckPending && !unlocked ? (
            <p className="mt-10 text-sm text-zinc-600 dark:text-zinc-400">Checking access...</p>
          ) : null}

          {unlocked ? (
            <section className="mt-10 border-t border-zinc-200 pt-8 dark:border-zinc-700">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Full article
              </h2>
              <div className="mt-4 whitespace-pre-wrap text-base leading-7 text-zinc-800 dark:text-zinc-200">
                {post.body}
              </div>
            </section>
          ) : null}

          {showPaywall ? (
            <section className="mt-10 rounded-xl border border-zinc-200 bg-zinc-50 p-6 dark:border-zinc-700 dark:bg-zinc-950">
              <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                Pay {unlockPriceLabel} XEC to Unlock
              </h3>
              {bip21Url ? (
                <>
                  <button
                    type="button"
                    disabled={payBusy}
                    onClick={handlePayToUnlock}
                    className="mt-5 inline-flex w-full items-center justify-center rounded-lg bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-60 dark:bg-emerald-400 dark:text-emerald-950"
                  >
                    {payBusy ? 'Opening wallet…' : `Pay ${unlockPriceLabel} XEC to Unlock`}
                  </button>
                  <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
                    Pay with XEC to unlock the full story.
                  </p>
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
                    (5% of all payments go to support the platform)
                  </p>
                  <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                    No signup required. Payments go directly to the author. Opens in Cashtab wallet.
                  </p>
                  {pollingActive ? (
                    <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-500">
                      Waiting for payment confirmation… checking every 2 seconds and listening for new
                      transactions to the author address.
                    </p>
                  ) : null}
                  <div className="mt-4 flex justify-center">
                    <PaymentQrCode value={bip21Url} />
                  </div>

                  <div className="mt-8 border-t border-zinc-200 pt-6 dark:border-zinc-700">
                    <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                      Already paid?
                    </p>
                    <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                      If unlock does not appear automatically, paste your transaction ID here.
                    </p>
                    <form onSubmit={handleVerifyTxid} className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
                      <div className="min-w-0 flex-1">
                        <label htmlFor="txid" className="sr-only">
                          Transaction ID
                        </label>
                        <input
                          id="txid"
                          type="text"
                          value={txidInput}
                          onChange={(e) => setTxidInput(e.target.value)}
                          placeholder="Transaction ID (txid)"
                          disabled={verifying}
                          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-400 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:ring-zinc-500"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={verifying || !txidInput.trim()}
                        className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
                      >
                        {verifying ? 'Verifying…' : "I've paid — unlock"}
                      </button>
                    </form>
                    {verifyError ? (
                      <p className="mt-3 text-sm text-red-600 dark:text-red-400" role="alert">
                        {verifyError}
                      </p>
                    ) : null}

                    <div className="mt-6 border-t border-zinc-200 pt-6 dark:border-zinc-700">
                      <button
                        type="button"
                        onClick={handleConnectCashtabWallet}
                        disabled={connectBusy}
                        className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-900 transition hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-zinc-900"
                      >
                        {connectBusy ? 'Connecting…' : 'Connect Cashtab Wallet'}
                      </button>

                      {walletNotPaidMessage ? (
                        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
                          This wallet hasn&apos;t paid for this article yet
                        </p>
                      ) : null}

                      {extensionMissing ? (
                        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
                          Install the Cashtab browser extension to restore access.{' '}
                          <a
                            href={CASHTAB_CHROME_STORE_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-zinc-900 underline dark:text-zinc-200"
                          >
                            Chrome Web Store
                          </a>
                        </p>
                      ) : null}

                      {connectOtherError ? (
                        <p className="mt-3 text-sm text-red-600 dark:text-red-400" role="alert">
                          {connectOtherError}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </>
              ) : (
                <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
                  Payment details are not configured for this post yet.
                </p>
              )}
            </section>
          ) : null}
        </article>
      </main>
    </div>
  )
}
