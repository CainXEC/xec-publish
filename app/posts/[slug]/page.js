'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { buildPaywallBip21, computePaymentSplit } from '@/lib/paymentSplit'
import { supabase } from '@/lib/supabase'
import PaymentQrCode from './PaymentQrCode'

const WALLET_AUTH_XEC = 5.5

export default function PublicPostPage() {
  const params = useParams()
  const slug = params?.slug

  const [post, setPost] = useState(null)
  const [author, setAuthor] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [loadingPost, setLoadingPost] = useState(true)

  const [unlocked, setUnlocked] = useState(false)
  const [unlockCheckPending, setUnlockCheckPending] = useState(true)

  const [pollingActive, setPollingActive] = useState(false)
  const pollRef = useRef(null)
  const [payBusy, setPayBusy] = useState(false)
  const payTxPollRef = useRef(null)
  const payBaselineTxidRef = useRef('')
  const payLastHandledTxidRef = useRef('')

  const [walletPanelOpen, setWalletPanelOpen] = useState(false)
  const [walletVerifyBusy, setWalletVerifyBusy] = useState(false)
  const [walletVerifyError, setWalletVerifyError] = useState(null)
  const [walletNotPaidMessage, setWalletNotPaidMessage] = useState(false)
  const [copiedPlatformAddress, setCopiedPlatformAddress] = useState(false)
  const walletAuthPollRef = useRef(null)
  const walletAuthBaselineTxidRef = useRef('')
  const walletAuthLastHandledTxidRef = useRef('')

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
    if (typeof window === 'undefined') return
    if (!post?.id || unlocked) return
    if (sessionStorage.getItem('pollingActive') === 'true') {
      setPollingActive(true)
      sessionStorage.removeItem('pollingActive')
    }
  }, [post?.id, unlocked])

  useEffect(() => {
    if (!pollingActive || !post?.id || unlocked) return

    pollRef.current = setInterval(() => {
      const stored =
        typeof window !== 'undefined'
          ? localStorage.getItem('walletAddress')?.trim()
          : ''
      void checkUnlock(post.id, stored || undefined)
    }, 3000)

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [pollingActive, post?.id, unlocked, checkUnlock])

  useEffect(() => {
    if (!post?.id || unlocked) return

    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      const stored =
        typeof window !== 'undefined'
          ? localStorage.getItem('walletAddress')?.trim()
          : ''
      void checkUnlock(post.id, stored || undefined)
      setPollingActive(true)
    }

    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [post?.id, unlocked, checkUnlock])

  useEffect(() => {
    return () => {
      if (walletAuthPollRef.current) {
        clearInterval(walletAuthPollRef.current)
        walletAuthPollRef.current = null
      }
      if (payTxPollRef.current) {
        clearInterval(payTxPollRef.current)
        payTxPollRef.current = null
      }
    }
  }, [])

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
  const authorAddressForLatestTx = author?.xec_address?.trim() || ''
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
  const platformAddressForAuth = platformXecAddress.replace(/^ecash:/, '')
  const walletAuthBip21Url = platformAddressForAuth
    ? `ecash:${platformAddressForAuth}?amount=${WALLET_AUTH_XEC}`
    : ''
  const walletAuthCashtabUrl = walletAuthBip21Url
    ? `https://cashtab.com/#/send?bip21=${walletAuthBip21Url}`
    : ''
  const unlockPriceLabel = formatXecAmount(priceXec)

  function openCashtab(url) {
    if (!url || typeof window === 'undefined') return
    try {
      sessionStorage.setItem('pollingActive', 'true')
    } catch {
      /* ignore */
    }
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  function handlePayToUnlock() {
    if (!cashtabUrl) return
    setPollingActive(true)
    setPayBusy(true)
    openCashtab(cashtabUrl)
    void startPayTxAutoVerify()
    setPayBusy(false)
  }

  const startPayTxAutoVerify = useCallback(async () => {
    if (!post?.id || !authorAddressForLatestTx) return

    if (payTxPollRef.current) {
      clearInterval(payTxPollRef.current)
      payTxPollRef.current = null
    }

    try {
      const baselineRes = await fetch(
        `/api/latest-tx/${encodeURIComponent(authorAddressForLatestTx)}`,
      )
      const baselineData = await baselineRes.json().catch(() => ({}))
      payBaselineTxidRef.current =
        baselineRes.ok && baselineData.txid ? baselineData.txid : ''
    } catch {
      payBaselineTxidRef.current = ''
    }

    const checkLatest = async () => {
      try {
        const latestTxRes = await fetch(
          `/api/latest-tx/${encodeURIComponent(authorAddressForLatestTx)}`,
        )
        const latestTxData = await latestTxRes.json().catch(() => ({}))
        const latestTxid = latestTxRes.ok ? latestTxData.txid : ''
        if (!latestTxid) return
        if (latestTxid === payBaselineTxidRef.current) return
        if (latestTxid === payLastHandledTxidRef.current) return
        payLastHandledTxidRef.current = latestTxid

        const verifyRes = await fetch('/api/verify-payment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ txid: latestTxid, postId: post.id }),
        })
        const verifyData = await verifyRes.json().catch(() => ({}))

        if (verifyRes.ok && verifyData.unlocked) {
          setUnlocked(true)
          setPollingActive(false)
          if (payTxPollRef.current) {
            clearInterval(payTxPollRef.current)
            payTxPollRef.current = null
          }
          return
        }

        const verifyError = String(verifyData.error || '').toLowerCase()
        if (
          verifyError.includes('already used') ||
          verifyError.includes('already')
        ) {
          const unlockRes = await fetch(
            `/api/check-unlock/${encodeURIComponent(post.id)}`,
          )
          const unlockData = await unlockRes.json().catch(() => ({}))
          if (unlockData.unlocked) {
            setUnlocked(true)
            setPollingActive(false)
            if (payTxPollRef.current) {
              clearInterval(payTxPollRef.current)
              payTxPollRef.current = null
            }
          }
        }
      } catch {
        /* ignore transient errors; interval continues */
      }
    }

    void checkLatest()
    payTxPollRef.current = setInterval(() => {
      void checkLatest()
    }, 3000)
  }, [authorAddressForLatestTx, post?.id])

  const processWalletAuthTxid = useCallback(
    async (txid) => {
      if (!post?.id || !txid) return
      if (walletAuthLastHandledTxidRef.current === txid) return
      walletAuthLastHandledTxidRef.current = txid

      const verifyRes = await fetch('/api/verify-wallet-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txid }),
      })
      const verifyData = await verifyRes.json().catch(() => ({}))
      if (!verifyRes.ok) {
        throw new Error(verifyData.error || 'Could not verify wallet payment.')
      }

      const walletAddress = verifyData.walletAddress?.trim?.() || ''
      const unlockedPostIds = Array.isArray(verifyData.unlockedPostIds)
        ? verifyData.unlockedPostIds
        : []

      if (walletAddress) {
        localStorage.setItem('walletAddress', walletAddress)
      }

      if (!unlockedPostIds.includes(post.id)) {
        setWalletNotPaidMessage(true)
        throw new Error('This wallet has not paid for this article yet.')
      }

      const ok = await checkUnlock(post.id, walletAddress || undefined)
      if (!ok) {
        throw new Error(
          'Wallet verified but unlock cookie could not be set yet. Please try again.',
        )
      }
      setUnlocked(true)
      setPollingActive(false)
    },
    [post?.id, checkUnlock],
  )

  const startWalletAuthAutoVerify = useCallback(async () => {
    if (!platformAddressForAuth || !post?.id) return

    if (walletAuthPollRef.current) {
      clearInterval(walletAuthPollRef.current)
      walletAuthPollRef.current = null
    }

    setWalletVerifyBusy(true)
    setWalletVerifyError(null)
    setWalletNotPaidMessage(false)

    try {
      const baselineRes = await fetch(
        `/api/latest-tx/${encodeURIComponent(platformAddressForAuth)}`,
      )
      const baselineData = await baselineRes.json().catch(() => ({}))
      walletAuthBaselineTxidRef.current =
        baselineRes.ok && baselineData.txid ? baselineData.txid : ''
    } catch {
      walletAuthBaselineTxidRef.current = ''
    }

    const checkLatest = async () => {
      try {
        const latestTxRes = await fetch(
          `/api/latest-tx/${encodeURIComponent(platformAddressForAuth)}`,
        )
        const latestTxData = await latestTxRes.json().catch(() => ({}))
        const latestTxid = latestTxRes.ok ? latestTxData.txid : ''
        if (!latestTxid) return
        if (latestTxid === walletAuthBaselineTxidRef.current) return

        await processWalletAuthTxid(latestTxid)
        if (walletAuthPollRef.current) {
          clearInterval(walletAuthPollRef.current)
          walletAuthPollRef.current = null
        }
        setWalletVerifyBusy(false)
      } catch (err) {
        setWalletVerifyError(err?.message || 'Could not verify wallet payment.')
        if (walletAuthPollRef.current) {
          clearInterval(walletAuthPollRef.current)
          walletAuthPollRef.current = null
        }
        setWalletVerifyBusy(false)
      }
    }

    void checkLatest()
    walletAuthPollRef.current = setInterval(() => {
      void checkLatest()
    }, 3000)
  }, [platformAddressForAuth, post?.id, processWalletAuthTxid])

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
                      Waiting for payment confirmation… checking every 3 seconds.
                    </p>
                  ) : null}
                  <div className="mt-4 flex justify-center">
                    <PaymentQrCode value={bip21Url} />
                  </div>

                  <div className="mt-8 border-t border-zinc-200 pt-6 dark:border-zinc-700">
                    <button
                      type="button"
                      onClick={() => setWalletPanelOpen((v) => !v)}
                      className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-900 transition hover:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-zinc-900"
                    >
                      Connect Wallet
                    </button>

                    {walletPanelOpen ? (
                      <div className="mt-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
                        <p className="text-sm text-zinc-700 dark:text-zinc-300">
                          Send 5.5 XEC from your wallet to verify ownership
                        </p>
                        <p className="mt-3 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                          Platform address
                        </p>
                        <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center">
                          <code className="break-all rounded bg-zinc-100 px-2 py-1 text-xs text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">
                            {platformXecAddress}
                          </code>
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(platformXecAddress)
                                setCopiedPlatformAddress(true)
                                window.setTimeout(() => setCopiedPlatformAddress(false), 1200)
                              } catch {
                                setWalletVerifyError('Could not copy address.')
                              }
                            }}
                            className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
                          >
                            {copiedPlatformAddress ? 'Copied' : 'Copy'}
                          </button>
                        </div>
                        <div className="mt-4 flex justify-center">
                          <PaymentQrCode value={walletAuthBip21Url} />
                        </div>
                        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                          <button
                            type="button"
                            onClick={() => {
                              openCashtab(walletAuthCashtabUrl)
                              void startWalletAuthAutoVerify()
                            }}
                            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-900 transition hover:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-zinc-900"
                          >
                            Open Cashtab
                          </button>
                        </div>

                        {walletNotPaidMessage ? (
                          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
                            This wallet has not paid for this article yet.
                          </p>
                        ) : null}

                        {walletVerifyError ? (
                          <p className="mt-3 text-sm text-red-600 dark:text-red-400" role="alert">
                            {walletVerifyError}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
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
