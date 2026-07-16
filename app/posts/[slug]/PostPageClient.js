'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import ActivityRail from '@/components/feed/ActivityRail'
import ArticleRail from '@/components/feed/ArticleRail'
import FeedTopbar from '@/components/feed/FeedTopbar'
import ArticleComments from '@/components/ArticleComments'
import TranslateButton from '@/components/TranslateButton'
import { FEED_CSS } from '@/components/feed/feedTheme'
import { ARTICLE_CSS } from './articleTheme'
import { encodeFeedOpReturnRaw, FEED_ACTION } from '@/lib/feedProtocol'
import { buildPaywallBip21, computePaymentSplit } from '@/lib/paymentSplit'
import { watchPaymentAddress, prewarmPaymentWatch } from '@/lib/ecash/watchPaymentAddress'
// Pocket-aware: eligible unlocks sign locally (payDirect → known txid, no
// address scan); everything else is the exact payWithCashtab behavior.
import { payDirect } from '@/lib/pocket/payGateway'
import { triggerPaymentSuccessEffect } from '@/lib/paymentSuccessEffect'
import {
  ensureAudioContextRunning,
  getSharedAudioContext,
  primeAudioContextOnUserGesture,
} from '@/lib/webAudioUnlock'
import { formatReadingTimeLabel } from '@/lib/getReadingTime'

function formatArticlePublishedDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatXec(amount) {
  const n = Number(amount)
  if (!Number.isFinite(n)) return '0'
  return n.toLocaleString('en-US')
}

export default function PostPageClient({
  initialPost,
  initialBodyHtml,
  initialUnlocked = false,
  hasPaywallMarker = false,
  initialAuthor,
  initialUnlockCount,
  initialCommentCount,
  slug = '',
}) {
  const router = useRouter()
  const [post] = useState(initialPost)
  const [author] = useState(initialAuthor)
  const [bodyHtml, setBodyHtml] = useState(initialBodyHtml ?? '')
  // AI translation ({ translated: html, title }); null = original.
  const [tr, setTr] = useState(null)

  const [unlocked, setUnlocked] = useState(initialUnlocked)
  const [unlockCheckPending, setUnlockCheckPending] = useState(!initialUnlocked)

  const [pollingActive, setPollingActive] = useState(false)
  const pollRef = useRef(null)
  const [payBusy, setPayBusy] = useState(false)
  const [paymentInitiated, setPaymentInitiated] = useState(false)
  // True once the payment tx has been SEEN on-chain but is not yet Avalanche-
  // final — lets the status message advance from "waiting" to "finalizing".
  const [paymentFinalizing, setPaymentFinalizing] = useState(false)
  const payTxPollRef = useRef(null)
  const payWatchRef = useRef(null)
  const payBaselineTxidRef = useRef('')
  const payLastHandledTxidRef = useRef('')
  // Set when the Pocket paid the unlock: the txid is KNOWN, so verification
  // targets that tx directly instead of scanning the author's address.
  const payPocketTxidRef = useRef('')
  /** Shared AudioContext, primed on Pay click (user gesture) for mobile unlock sound after async verify. */
  const unlockAudioContextRef = useRef(null)

  const [commentCount, setCommentCount] = useState(initialCommentCount)
  const [unlockCount, setUnlockCount] = useState(initialUnlockCount)
  const [copiedShareLink, setCopiedShareLink] = useState(false)
  const [readerWalletAddress, setReaderWalletAddress] = useState('')
  // Session identity from GET /api/me (the HttpOnly pow_session cookie).
  // { authenticated, accountId, authorId, isAdmin, address, handle, identity, unlockedPostIds } | null
  const [me, setMe] = useState(null)
  const [isFollowingAuthor, setIsFollowingAuthor] = useState(false)
  const [followAuthorBusy, setFollowAuthorBusy] = useState(false)
  const shareCopyTimeoutRef = useRef(null)

  // Author / admin identity now comes from the wallet session (/api/me), not
  // Supabase. Derived each render so it tracks the session automatically once
  // /api/me resolves. canViewFullPost keys off these, so author/admin bypass
  // the paywall on their own posts with no separate auto-unlock needed.
  const isAuthorSession = Boolean(
    me?.authorId && post?.author_id && me.authorId === post.author_id,
  )
  const isAdminSession = me?.isAdmin === true

  useEffect(() => {
    setBodyHtml(initialBodyHtml ?? '')
  }, [initialBodyHtml])

  useEffect(() => {
    setUnlocked(initialUnlocked)
    if (initialUnlocked) {
      setUnlockCheckPending(false)
    }
  }, [initialUnlocked])

  // Reader/author identity comes solely from the wallet session via /api/me.
  // readerWalletAddress mirrors me.address so existing consumers (follows, the
  // byline follow button) are unchanged. On logout /api/me returns null and we
  // clear the mirror.
  const refetchMe = useCallback(async () => {
    try {
      const res = await fetch('/api/me', { cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      const authed = data && data.authenticated ? data : null
      setMe(authed)
      setReaderWalletAddress(authed?.address ? String(authed.address).trim() : '')
      if (!authed) setIsFollowingAuthor(false)
      return authed
    } catch {
      return null
    }
  }, [])

  useEffect(() => {
    void refetchMe()
  }, [refetchMe])

  useEffect(() => {
    const wallet = readerWalletAddress.trim()
    const authorId = post?.author_id
    if (!wallet || !authorId) {
      setIsFollowingAuthor(false)
      return
    }
    let cancelled = false
    fetch(
      `/api/follows?walletAddress=${encodeURIComponent(wallet)}&authorId=${encodeURIComponent(authorId)}`,
      { cache: 'no-store' },
    )
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setIsFollowingAuthor(data.following ?? false)
      })
      .catch(() => {
        if (!cancelled) setIsFollowingAuthor(false)
      })
    return () => {
      cancelled = true
    }
  }, [readerWalletAddress, post?.author_id])

  const handleFollowAuthor = useCallback(async () => {
    const wallet = readerWalletAddress.trim()
    const authorId = post?.author_id
    if (!wallet || !authorId || followAuthorBusy) return
    setFollowAuthorBusy(true)
    try {
      const res = await fetch('/api/follows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress: wallet, authorId }),
      })
      const data = await res.json().catch(() => ({}))
      setIsFollowingAuthor(data.following ?? false)
    } catch {
      /* ignore */
    } finally {
      setFollowAuthorBusy(false)
    }
  }, [followAuthorBusy, post?.author_id, readerWalletAddress])

  useEffect(() => {
    return () => {
      if (shareCopyTimeoutRef.current) {
        clearTimeout(shareCopyTimeoutRef.current)
      }
    }
  }, [])

  const getCurrentPageUrl = useCallback(() => {
    if (typeof window === 'undefined') return ''
    return window.location.href
  }, [])

  const handleShareX = useCallback(() => {
    const pageUrl = getCurrentPageUrl()
    if (!pageUrl) return
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(post?.title ?? '')}&url=${encodeURIComponent(pageUrl)}`
    window.open(url, '_blank', 'noopener,noreferrer')
  }, [getCurrentPageUrl, post?.title])

  const handleSharePow = useCallback(() => {
    const pageUrl = getCurrentPageUrl()
    if (!pageUrl) return
    const text = `${post?.title ?? ''}\n\n${pageUrl}`.trim()
    window.location.href = `/?share=${encodeURIComponent(text)}`
  }, [getCurrentPageUrl, post?.title])

  const handleCopyArticleLink = useCallback(async () => {
    const pageUrl = getCurrentPageUrl()
    if (!pageUrl) return
    try {
      await navigator.clipboard.writeText(pageUrl)
      setCopiedShareLink(true)
      if (shareCopyTimeoutRef.current) {
        clearTimeout(shareCopyTimeoutRef.current)
      }
      shareCopyTimeoutRef.current = window.setTimeout(() => {
        setCopiedShareLink(false)
      }, 2000)
    } catch {
      setCopiedShareLink(false)
    }
  }, [getCurrentPageUrl])

  const triggerPaywallUnlockEffect = useCallback(() => {
    triggerPaymentSuccessEffect(unlockAudioContextRef.current ?? undefined)
  }, [])

  const checkUnlock = useCallback(async (postId, walletAddress) => {
    const url = walletAddress
      ? `/api/check-unlock/${encodeURIComponent(postId)}?walletAddress=${encodeURIComponent(walletAddress)}`
      : `/api/check-unlock/${encodeURIComponent(postId)}`

    try {
      const res = await fetch(url)
      const data = await res.json().catch(() => ({}))
      if (data.unlocked) {
        setUnlocked(true)
        setPollingActive(false)
        router.refresh()
        return true
      }
    } catch {
      // Network blip — treat as "not unlocked" so the caller shows the paywall.
      // The polling checks re-run, so a transient failure self-heals.
    }
    return false
  }, [router])

  const fetchCommentCount = useCallback(async (postId) => {
    if (!postId) return
    try {
      const res = await fetch(
        `/api/comments/count/${encodeURIComponent(postId)}`,
        { cache: 'no-store' },
      )
      const data = await res.json().catch(() => ({}))
      if (res.ok && Number.isFinite(Number(data?.count))) {
        setCommentCount(Number(data.count))
      }
    } catch {
      /* ignore count fetch errors */
    }
  }, [])

  const fetchUnlockCount = useCallback(async (postId) => {
    if (!postId) return
    try {
      const res = await fetch(
        `/api/unlock-count/${encodeURIComponent(postId)}`,
        { cache: 'no-store' },
      )
      const data = await res.json().catch(() => ({}))
      if (res.ok && Number.isFinite(Number(data?.count))) {
        setUnlockCount(Number(data.count))
      }
    } catch {
      /* ignore count fetch errors */
    }
  }, [])

  useEffect(() => {
    if (!post?.id) return
    if (initialUnlocked) return

    let cancelled = false

    async function initialUnlock() {
      setUnlockCheckPending(true)
      try {
        // cookie fast-path; address-based unlock now comes from /api/me below.
        await checkUnlock(post.id)
      } catch {
        // A failed check must fail safe TO the paywall — never leave the reader
        // stuck on "Checking access...". If they've actually paid, the address
        // fast-path (/api/me unlockedPostIds) and the polling checks still
        // reconcile them to unlocked.
      } finally {
        if (!cancelled) setUnlockCheckPending(false)
      }
    }

    void initialUnlock()

    return () => {
      cancelled = true
    }
  }, [post?.id, checkUnlock, initialUnlocked])

  // Cross-device unlock paint: if this account's proven address has unlocked
  // this post (per /api/me), reveal it without needing the per-device cookie.
  useEffect(() => {
    if (!post?.id || unlocked) return
    if (Array.isArray(me?.unlockedPostIds) && me.unlockedPostIds.includes(post.id)) {
      setUnlocked(true)
      setUnlockCheckPending(false)
    }
  }, [me, post?.id, unlocked])

  // Session changed elsewhere (Nav logout, or our own pay-to-unlock login).
  // Re-read identity and re-run SSR entitlement so locked content re-locks on
  // logout (server decides based on session + unlock cookie).
  useEffect(() => {
    if (typeof window === 'undefined') return
    function onSessionChanged() {
      void refetchMe()
      router.refresh()
    }
    window.addEventListener('sessionChanged', onSessionChanged)
    return () => {
      window.removeEventListener('sessionChanged', onSessionChanged)
    }
  }, [refetchMe, router])


  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!post?.id || unlocked || isAuthorSession) return
    if (sessionStorage.getItem('pollingActive') === 'true') {
      setPollingActive(true)
      sessionStorage.removeItem('pollingActive')
    }
  }, [post?.id, unlocked, isAuthorSession])

  useEffect(() => {
    if (!pollingActive || !post?.id || unlocked || isAuthorSession) return

    pollRef.current = setInterval(() => {
      const wallet = readerWalletAddress.trim()
      void checkUnlock(post.id, wallet || undefined)
    }, 1200)

    // Live nudge: a Chronik websocket on the author's address fires an immediate
    // unlock check the moment the payment lands, instead of waiting up to 3s for
    // the next tick. check-unlock is authoritative server-side, so an unrelated
    // tx to the author just costs one harmless check. (Derived inline from
    // `author` here — the memoized address var is declared later in render.)
    const runUnlockCheck = () => {
      const wallet = readerWalletAddress.trim()
      void checkUnlock(post.id, wallet || undefined)
    }
    // Second callback = wake (tab back to foreground / ws reconnect): the unlock
    // payment may have broadcast while this tab was suspended in Cashtab.
    const stopWatch = watchPaymentAddress(author?.xec_address?.trim() || '', runUnlockCheck, runUnlockCheck)

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
      stopWatch()
    }
  }, [pollingActive, post?.id, unlocked, isAuthorSession, checkUnlock, readerWalletAddress, author?.xec_address])

  useEffect(() => {
    if (!post?.id || unlocked || isAuthorSession) return

    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      const wallet = readerWalletAddress.trim()
      void checkUnlock(post.id, wallet || undefined)
      setPollingActive(true)
    }

    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [post?.id, unlocked, isAuthorSession, checkUnlock, readerWalletAddress])

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      const ctx = unlockAudioContextRef.current
      if (ctx) void ensureAudioContextRunning(ctx)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  useEffect(() => {
    return () => {
      if (payTxPollRef.current) {
        clearInterval(payTxPollRef.current)
        payTxPollRef.current = null
      }
      if (payWatchRef.current) {
        payWatchRef.current()
        payWatchRef.current = null
      }
    }
  }, [])

  const priceXec = Number(post?.price_xec ?? 0)
  const authorXecAddress = (author?.xec_address ?? '')
    .trim()
    .replace(/^ecash:/, '')
  const platformXecAddress =
    typeof process.env.NEXT_PUBLIC_PLATFORM_XEC_ADDRESS === 'string'
      ? process.env.NEXT_PUBLIC_PLATFORM_XEC_ADDRESS.trim()
      : ''
  const paymentSplit = post ? computePaymentSplit(post.price_xec) : null
  const authorAddrForBip21 =
    author?.xec_address?.trim() ||
    (authorXecAddress ? `ecash:${authorXecAddress}` : '')
  const authorAddressForLatestTx = authorAddrForBip21
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
          // POWR unlock marker (OP_7, no payload). Which article the payment
          // unlocks is attributed server-side from the DB, not on-chain.
          encodeFeedOpReturnRaw({ action: FEED_ACTION.UNLOCK }),
        )
      : ''
  const cashtabUrl = bip21Url
    ? `https://cashtab.com/#/send?bip21=${bip21Url}`
    : ''
  const unlockPriceLabel = formatXec(priceXec)

  function openCashtab() {
    if (!cashtabUrl || typeof window === 'undefined') return
    try {
      sessionStorage.setItem('pollingActive', 'true')
    } catch {
      /* ignore */
    }
    // Pocket if eligible (signs locally; the .then hands us the txid), else
    // Cashtab extension popup or web tab — exactly one, never both. Rejecting
    // in the extension popup drops back out of the waiting state.
    void payDirect({ kind: 'unlock', amountXec: priceXec, bip21: bip21Url, cashtabUrl }).then((res) => {
      if (res.ok && res.via === 'pocket' && res.txid) {
        // Known txid: the auto-verify loop targets it directly from now on.
        payPocketTxidRef.current = res.txid
        setPaymentFinalizing(true)
        return
      }
      if (!res.ok && res.reason === 'denied') {
        if (payTxPollRef.current) {
          clearInterval(payTxPollRef.current)
          payTxPollRef.current = null
        }
        if (payWatchRef.current) {
          payWatchRef.current()
          payWatchRef.current = null
        }
        setPaymentInitiated(false)
        setPaymentFinalizing(false)
        setPollingActive(false)
        try {
          sessionStorage.removeItem('pollingActive')
        } catch {
          /* ignore */
        }
      }
      // pocket_error: leave the waiting UI + its manual Cashtab link in place —
      // paying from Cashtab still completes this unlock.
    })
  }

  function handlePayToUnlock() {
    if (!cashtabUrl) return
    // Warm the shared payment socket at the click so it's subscribed before the
    // unlock payment lands, instead of racing the ~1.7s first-open handshake.
    prewarmPaymentWatch()
    if (typeof window !== 'undefined') {
      const ctx = getSharedAudioContext()
      unlockAudioContextRef.current = ctx
      if (ctx) {
        void primeAudioContextOnUserGesture(ctx)
      }
    }
    setPaymentInitiated(true)
    setPaymentFinalizing(false)
    setPollingActive(true)
    setPayBusy(true)
    openCashtab()
    void startPayTxAutoVerify()
    setPayBusy(false)
  }

  // Pay doubles as login: verify-payment has ALREADY minted the pow_session
  // server-side (pay-scope) as part of the unlock. Pull the fresh identity here,
  // and notify Nav (and any other listener) so it re-reads /api/me.
  const persistReaderAfterPaywallUnlock = useCallback(async () => {
    await refetchMe()
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('sessionChanged'))
    }
  }, [refetchMe])

  const startPayTxAutoVerify = useCallback(async () => {
    if (!post?.id || !authorAddressForLatestTx) return

    if (payTxPollRef.current) {
      clearInterval(payTxPollRef.current)
      payTxPollRef.current = null
    }
    if (payWatchRef.current) {
      payWatchRef.current()
      payWatchRef.current = null
    }
    // Fresh attempt: forget any pocket txid from a previous run. (openCashtab's
    // payDirect .then always resolves after this synchronous section.)
    payPocketTxidRef.current = ''

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
        // Pocket-paid: the txid is known — verify it directly, skip the scan.
        let latestTxid = payPocketTxidRef.current
        if (!latestTxid) {
          const latestTxRes = await fetch(
            `/api/latest-tx/${encodeURIComponent(authorAddressForLatestTx)}`,
          )
          const latestTxData = await latestTxRes.json().catch(() => ({}))
          latestTxid = latestTxRes.ok ? latestTxData.txid : ''
          if (!latestTxid) return
          if (latestTxid === payBaselineTxidRef.current) return
          if (latestTxid === payLastHandledTxidRef.current) return
          payLastHandledTxidRef.current = latestTxid
        }

        const verifyRes = await fetch('/api/verify-payment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ txid: latestTxid, postId: post.id }),
        })
        const verifyData = await verifyRes.json().catch(() => ({}))

        // Payment seen but not yet Avalanche-final (202). Surface the interim
        // "finalizing" state, then clear the handled ref so the next poll
        // retries this same txid — the unlock row is written only once finality
        // lands, so we must keep asking until then.
        if (verifyRes.status === 202 || verifyData.finalizing) {
          setPaymentFinalizing(true)
          payLastHandledTxidRef.current = ''
          return
        }

        if (verifyRes.ok && verifyData.unlocked) {
          triggerPaywallUnlockEffect()
          setPaymentFinalizing(false)
          setUnlocked(true)
          setPollingActive(false)
          router.refresh()
          if (payTxPollRef.current) {
            clearInterval(payTxPollRef.current)
            payTxPollRef.current = null
          }
          if (payWatchRef.current) {
            payWatchRef.current()
            payWatchRef.current = null
          }
          void persistReaderAfterPaywallUnlock()
          void fetchUnlockCount(post.id)
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
            triggerPaywallUnlockEffect()
            setPaymentFinalizing(false)
            setUnlocked(true)
            setPollingActive(false)
            router.refresh()
            if (payTxPollRef.current) {
              clearInterval(payTxPollRef.current)
              payTxPollRef.current = null
            }
            if (payWatchRef.current) {
              payWatchRef.current()
              payWatchRef.current = null
            }
            void persistReaderAfterPaywallUnlock()
            void fetchUnlockCount(post.id)
          }
        }
      } catch {
        /* ignore transient errors; interval continues */
      }
    }

    void checkLatest()
    payTxPollRef.current = setInterval(() => {
      void checkLatest()
    }, 1200)
    // Live nudge: a Chronik websocket on the author's address fires verify-payment
    // the instant the unlock payment lands, instead of waiting for the next tick.
    // checkLatest re-baselines + verifies + gates on finality, so an unrelated tx
    // to the author just costs one harmless check. Third arg = wake (tab back to
    // foreground / ws reconnect): the payment may have broadcast while the tab
    // was suspended in Cashtab — check immediately on return.
    payWatchRef.current = watchPaymentAddress(
      authorAddressForLatestTx,
      () => { void checkLatest() },
      () => { void checkLatest() },
    )
  }, [
    authorAddressForLatestTx,
    fetchUnlockCount,
    persistReaderAfterPaywallUnlock,
    post?.id,
    router,
    triggerPaywallUnlockEffect,
  ])

  if (!post) {
    return null
  }

  const articleDateIso = post.published_at ?? post.created_at
  const previewReadTimeLabel = formatReadingTimeLabel(post.reading_time_minutes)
  const canViewFullPost = unlocked || isAuthorSession || isAdminSession
  const showPaywall = !canViewFullPost && !unlockCheckPending

  return (
    <div className="pow-article">
      <style>{ARTICLE_CSS}</style>

      {/* Shared feed header (wordmark + hamburger on mobile). Hosted in its own
          .pow-feed scope so it renders identically to the homepage without the
          article theme taking over. */}
      <div className="pow-feed topbar-host">
        <style>{FEED_CSS}</style>
        <FeedTopbar signedIn={me?.accountId != null} isAuthor={me?.authorId != null} />
      </div>

      {/* Desktop: the story keeps the shell — the front page stays on the
          left (current story highlighted), the live ticker on the right.
          The rails are .pow-feed-scoped cards, so each rides in its own
          scope host; below the tier widths the asides are display:none and
          the article renders exactly as before. */}
      <div className="art-cols">
      <aside className="art-left" aria-label="The front page — long-form writing">
        <div className="pow-feed railhost">
          <ArticleRail minWidth={1520} currentSlug={slug} />
        </div>
      </aside>
      <main className="wrap">
        <article className="article">
          <h1 className="arttitle">{tr?.title ?? post.title}</h1>
          <p className="artbyline">
            <span>By</span>
            {/* Byline = the account's live display identity: bound handle, else
                legacy username, else the raw eCash address (shortened) — a
                wallet-native author with no handle is never "Unknown". The
                /@identifier route resolves handles AND bare addresses. */}
            {author?.display_handle?.trim() || author?.username?.trim() || authorXecAddress ? (
              <>
                <Link
                  href={
                    author?.display_handle?.trim()
                      ? `/@${encodeURIComponent(author.display_handle.trim())}`
                      : author?.username?.trim()
                        ? `/u/${encodeURIComponent(author.username.trim())}`
                        : `/@${encodeURIComponent(authorXecAddress)}`
                  }
                  className="bylink"
                  title={
                    !author?.display_handle?.trim() && !author?.username?.trim() && authorXecAddress
                      ? `ecash:${authorXecAddress}`
                      : undefined
                  }
                  style={
                    author?.display_handle?.trim() && author?.handle_color
                      ? { '--hc': author.handle_color }
                      : undefined
                  }
                >
                  {author?.display_handle?.trim() ||
                    author?.username?.trim() ||
                    `${authorXecAddress.slice(0, 8)}…${authorXecAddress.slice(-4)}`}
                </Link>
                {readerWalletAddress.trim() && post.author_id && !isAuthorSession ? (
                  <button
                    type="button"
                    title={isFollowingAuthor ? undefined : 'Follow'}
                    aria-label={isFollowingAuthor ? 'Following author' : 'Follow author'}
                    onClick={() => void handleFollowAuthor()}
                    disabled={followAuthorBusy}
                    className={`followbtn${isFollowingAuthor ? ' on' : ''}`}
                  >
                    {followAuthorBusy ? (
                      '…'
                    ) : isFollowingAuthor ? (
                      <>
                        <span aria-hidden>✓</span> Following
                      </>
                    ) : (
                      <span aria-hidden>+</span>
                    )}
                  </button>
                ) : null}
              </>
            ) : (
              <span>Unknown author</span>
            )}
          </p>
          {articleDateIso ? (
            <p className="artdate">
              <time dateTime={articleDateIso}>{formatArticlePublishedDate(articleDateIso)}</time>
            </p>
          ) : null}
          <div className="share">
            <button
              type="button"
              onClick={handleSharePow}
              className="sharebtn sharebtn-pow"
              aria-label="Share to Proof of Writing"
              title="Share to Proof of Writing"
            >
              <span className="sharebtn-pmark" aria-hidden="true">
                P
              </span>
            </button>
            <button type="button" onClick={handleShareX} className="sharebtn">
              𝕏
            </button>
            <button
              type="button"
              onClick={() => void handleCopyArticleLink()}
              className="sharebtn"
            >
              Copy Link
            </button>
            {copiedShareLink ? <span className="copied">Copied!</span> : null}
          </div>
          <div className="artmeta">
            {post.reading_time_minutes ? (
              <span className="metaitem">{post.reading_time_minutes} min read</span>
            ) : null}
            <span className="metaitem">
              🏷️ <span>{priceXec > 0 ? `${formatXec(priceXec)} XEC` : 'Free'}</span>
            </span>
            <span className="metaitem">
              🔓 <span>{unlockCount}</span>
            </span>

            <button
              type="button"
              onClick={() =>
                document.getElementById('comments')?.scrollIntoView({ behavior: 'smooth' })
              }
              className="metaitem"
            >
              💬 <span>{commentCount}</span>
            </button>

            <TranslateButton
              kind="article"
              id={slug}
              onTranslated={setTr}
              onShowOriginal={() => setTr(null)}
              className="metaitem"
            />
          </div>

          {unlockCheckPending && !canViewFullPost ? (
            <p className="checking">Checking access...</p>
          ) : null}

          {showPaywall && hasPaywallMarker ? (
            <section className="section">
              <h2 className="preview-head">
                Preview
                {previewReadTimeLabel ? (
                  <span className="preview-time"> ({previewReadTimeLabel})</span>
                ) : null}
              </h2>
              <div
                className="prose"
                dangerouslySetInnerHTML={{ __html: tr?.translated ?? bodyHtml }}
              />

              <div className="paywrap">
                {bip21Url ? (
                  <>
                    <button
                      type="button"
                      disabled={payBusy}
                      onClick={handlePayToUnlock}
                      className="unlockbtn"
                    >
                      {payBusy
                        ? 'Opening wallet…'
                        : `Pay ${unlockPriceLabel} XEC to unlock`}
                    </button>
                    <p className="unlocknote">
                      (6% of all unlock payments go to support the platform)
                    </p>
                    {pollingActive && paymentInitiated ? (
                      <div className="pollcard">
                        <div className="pollrow">
                          <span aria-hidden className="spinner" />
                          <p className="pollmsg">
                            {paymentFinalizing
                              ? 'Payment seen — finalizing…'
                              : 'Waiting for payment…'}
                          </p>
                        </div>
                        <p className="pollsub">
                          {paymentFinalizing
                            ? 'Almost there — confirming Avalanche finality'
                            : 'This usually takes a few seconds'}
                        </p>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p className="paymissing">
                    Payment details are not configured for this post yet.
                  </p>
                )}
              </div>
            </section>
          ) : null}

          {canViewFullPost ? (
            <section className="section">
              <div
                className="prose"
                dangerouslySetInnerHTML={{
                  __html: tr?.translated ?? bodyHtml,
                }}
              />

              <ArticleComments
                postId={post.id}
                canComment={unlocked || isAuthorSession}
                me={me}
                isAuthorSession={isAuthorSession}
                onChanged={() => fetchCommentCount(post.id)}
              />
            </section>
          ) : null}

          {showPaywall && !hasPaywallMarker ? (
            <section className="section">
              {bodyHtml ? (
                <div
                  className="prose"
                  dangerouslySetInnerHTML={{ __html: tr?.translated ?? bodyHtml }}
                />
              ) : null}
              <div className="paywrap">
                {bip21Url ? (
                  <>
                    <button
                      type="button"
                      disabled={payBusy}
                      onClick={handlePayToUnlock}
                      className="unlockbtn"
                    >
                      {payBusy
                        ? 'Opening wallet…'
                        : `Pay ${unlockPriceLabel} XEC to unlock`}
                    </button>
                    <p className="unlocknote">
                      (6% of all unlock payments go to support the platform)
                    </p>
                    {pollingActive && paymentInitiated ? (
                      <div className="pollcard">
                        <div className="pollrow">
                          <span aria-hidden className="spinner" />
                          <p className="pollmsg">
                            {paymentFinalizing
                              ? 'Payment seen — finalizing…'
                              : 'Waiting for payment…'}
                          </p>
                        </div>
                        <p className="pollsub">
                          {paymentFinalizing
                            ? 'Almost there — confirming Avalanche finality'
                            : 'This usually takes a few seconds'}
                        </p>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p className="paymissing">
                    Payment details are not configured for this post yet.
                  </p>
                )}
              </div>
            </section>
          ) : null}
        </article>
      </main>

      <aside className="art-right" aria-label="Live on-chain activity">
        <div className="pow-feed railhost">
          <ActivityRail minWidth={1240} />
        </div>
      </aside>
      </div>
    </div>
  )
}
