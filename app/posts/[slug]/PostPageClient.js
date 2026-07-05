'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import Nav from '@/components/Nav'
import { charCounterClassName } from '@/lib/charCounterClassName'
import { encodePostIdOpReturnRaw } from '@/lib/opReturnEncode'
import { buildPaywallBip21, computePaymentSplit } from '@/lib/paymentSplit'
import { triggerPaymentSuccessEffect } from '@/lib/paymentSuccessEffect'
import {
  ensureAudioContextRunning,
  getSharedAudioContext,
  primeAudioContextOnUserGesture,
} from '@/lib/webAudioUnlock'
import { formatReadingTimeLabel } from '@/lib/getReadingTime'

const COMMENT_MAX_LEN = 500
const COMMENT_WARN_WITHIN = 50

function formatCommentDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

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
}) {
  const router = useRouter()
  const [post] = useState(initialPost)
  const [author] = useState(initialAuthor)
  const [bodyHtml, setBodyHtml] = useState(initialBodyHtml ?? '')

  const [unlocked, setUnlocked] = useState(initialUnlocked)
  const [unlockCheckPending, setUnlockCheckPending] = useState(!initialUnlocked)

  const [pollingActive, setPollingActive] = useState(false)
  const pollRef = useRef(null)
  const [payBusy, setPayBusy] = useState(false)
  const [paymentInitiated, setPaymentInitiated] = useState(false)
  const payTxPollRef = useRef(null)
  const payBaselineTxidRef = useRef('')
  const payLastHandledTxidRef = useRef('')
  /** Shared AudioContext, primed on Pay click (user gesture) for mobile unlock sound after async verify. */
  const unlockAudioContextRef = useRef(null)

  const [commentCount, setCommentCount] = useState(initialCommentCount)
  const [unlockCount, setUnlockCount] = useState(initialUnlockCount)
  const [comments, setComments] = useState([])
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [commentsError, setCommentsError] = useState(null)
  const [commentText, setCommentText] = useState('')
  const [commentSubmitting, setCommentSubmitting] = useState(false)
  const [commentActionError, setCommentActionError] = useState(null)
  const [deletingCommentId, setDeletingCommentId] = useState(null)
  const [copiedCommentIds, setCopiedCommentIds] = useState({})
  const [copiedShareLink, setCopiedShareLink] = useState(false)
  const [readerWalletAddress, setReaderWalletAddress] = useState('')
  // Session identity from GET /api/me (the HttpOnly pow_session cookie).
  // { authenticated, accountId, authorId, isAdmin, address, handle, identity, unlockedPostIds } | null
  const [me, setMe] = useState(null)
  const [isFollowingAuthor, setIsFollowingAuthor] = useState(false)
  const [followAuthorBusy, setFollowAuthorBusy] = useState(false)
  const [pinBusy, setPinBusy] = useState(false)
  const commentCopyTimeoutsRef = useRef({})
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
      Object.values(commentCopyTimeoutsRef.current).forEach((timeoutId) => {
        clearTimeout(timeoutId)
      })
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

  const handleShareFacebook = useCallback(() => {
    const pageUrl = getCurrentPageUrl()
    if (!pageUrl) return
    const url = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(pageUrl)}`
    window.open(url, '_blank', 'noopener,noreferrer')
  }, [getCurrentPageUrl])

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

  const handleCopyCommentWallet = useCallback(async (commentId, walletAddress) => {
    if (!commentId || !walletAddress) return
    try {
      await navigator.clipboard.writeText(walletAddress)
      setCopiedCommentIds((prev) => ({ ...prev, [commentId]: true }))
      if (commentCopyTimeoutsRef.current[commentId]) {
        clearTimeout(commentCopyTimeoutsRef.current[commentId])
      }
      commentCopyTimeoutsRef.current[commentId] = window.setTimeout(() => {
        setCopiedCommentIds((prev) => ({ ...prev, [commentId]: false }))
        delete commentCopyTimeoutsRef.current[commentId]
      }, 2000)
    } catch {
      setCopiedCommentIds((prev) => ({ ...prev, [commentId]: false }))
    }
  }, [])

  const triggerPaywallUnlockEffect = useCallback(() => {
    triggerPaymentSuccessEffect(unlockAudioContextRef.current ?? undefined)
  }, [])

  const checkUnlock = useCallback(async (postId, walletAddress) => {
    const url = walletAddress
      ? `/api/check-unlock/${encodeURIComponent(postId)}?walletAddress=${encodeURIComponent(walletAddress)}`
      : `/api/check-unlock/${encodeURIComponent(postId)}`

    const res = await fetch(url)
    const data = await res.json().catch(() => ({}))
    if (data.unlocked) {
      setUnlocked(true)
      setPollingActive(false)
      router.refresh()
      return true
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

  const fetchComments = useCallback(async (postId) => {
    if (!postId) return
    setCommentsLoading(true)
    setCommentsError(null)
    try {
      const res = await fetch(`/api/comments/${encodeURIComponent(postId)}`, {
        cache: 'no-store',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setCommentsError(data?.error || 'Could not load comments.')
        setComments([])
        return
      }
      setComments(Array.isArray(data?.comments) ? data.comments : [])
    } catch {
      setCommentsError('Could not load comments.')
      setComments([])
    } finally {
      setCommentsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!post?.id) return
    if (initialUnlocked) return

    let cancelled = false

    async function initialUnlock() {
      setUnlockCheckPending(true)
      // cookie fast-path; address-based unlock now comes from /api/me below.
      await checkUnlock(post.id)
      if (!cancelled) setUnlockCheckPending(false)
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
    if (!isAuthorSession || !post?.id) return
    void fetch('/api/notifications/mark-read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ post_id: post.id }),
    })
  }, [isAuthorSession, post?.id])

  useEffect(() => {
    if (!post?.id || (!unlocked && !isAuthorSession)) return
    void fetchComments(post.id)
  }, [post?.id, unlocked, isAuthorSession, fetchComments])

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
    }, 3000)

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [pollingActive, post?.id, unlocked, isAuthorSession, checkUnlock, readerWalletAddress])

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
          encodePostIdOpReturnRaw(post.id),
        )
      : ''
  const cashtabUrl = bip21Url
    ? `https://cashtab.com/#/send?bip21=${bip21Url}`
    : ''
  const unlockPriceLabel = formatXec(priceXec)

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
    if (typeof window !== 'undefined') {
      const ctx = getSharedAudioContext()
      unlockAudioContextRef.current = ctx
      if (ctx) {
        void primeAudioContextOnUserGesture(ctx)
      }
    }
    setPaymentInitiated(true)
    setPollingActive(true)
    setPayBusy(true)
    openCashtab(cashtabUrl)
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
          triggerPaywallUnlockEffect()
          setUnlocked(true)
          setPollingActive(false)
          router.refresh()
          if (payTxPollRef.current) {
            clearInterval(payTxPollRef.current)
            payTxPollRef.current = null
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
            setUnlocked(true)
            setPollingActive(false)
            router.refresh()
            if (payTxPollRef.current) {
              clearInterval(payTxPollRef.current)
              payTxPollRef.current = null
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
    }, 3000)
  }, [
    authorAddressForLatestTx,
    fetchUnlockCount,
    persistReaderAfterPaywallUnlock,
    post?.id,
    router,
    triggerPaywallUnlockEffect,
  ])

  const handlePostComment = useCallback(async () => {
    if (!post?.id || (!unlocked && !isAuthorSession)) return
    const content = commentText.trim()
    if (!content) {
      setCommentActionError('Comment content is required.')
      return
    }
    setCommentSubmitting(true)
    setCommentActionError(null)
    try {
      // Identity + authorization come from the session cookie (sent
      // automatically same-origin); the route ignores any body-supplied address.
      const res = await fetch(`/api/comments/${encodeURIComponent(post.id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setCommentActionError(data?.error || 'Could not post comment.')
        return
      }
      setCommentText('')
      await fetchComments(post.id)
      await fetchCommentCount(post.id)
    } finally {
      setCommentSubmitting(false)
    }
  }, [
    commentText,
    fetchCommentCount,
    fetchComments,
    isAuthorSession,
    post?.id,
    unlocked,
  ])

  const handleDeleteComment = useCallback(async (commentId) => {
    if (!post?.id || !commentId) return
    if (!window.confirm('Are you sure you want to delete this comment?')) return
    setDeletingCommentId(commentId)
    setCommentActionError(null)
    try {
      // Authorization (author/admin/own-comment) is decided server-side from
      // the session cookie; the route ignores any body-supplied identity.
      const res = await fetch(`/api/comments/${encodeURIComponent(post.id)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commentId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setCommentActionError(data?.error || 'Could not delete comment.')
        return
      }
      await fetchComments(post.id)
      await fetchCommentCount(post.id)
    } finally {
      setDeletingCommentId(null)
    }
  }, [
    fetchCommentCount,
    fetchComments,
    post?.id,
  ])

  const handlePinHomepage = useCallback(async () => {
    if (!post?.id || pinBusy) return
    setPinBusy(true)
    try {
      const method = post.pinned === true ? 'DELETE' : 'POST'
      const res = await fetch(`/api/posts/${encodeURIComponent(post.id)}/pin`, {
        method,
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        window.alert(data?.error || 'Could not update pin.')
        return
      }
      router.refresh()
    } finally {
      setPinBusy(false)
    }
  }, [pinBusy, post.id, post.pinned, router])

  if (!post) {
    return null
  }

  const articleDateIso = post.published_at ?? post.created_at
  const earningsSats = Number(post.earnings ?? 0)
  const earningsXec =
    Number.isFinite(earningsSats) && earningsSats > 0 ? Math.round(earningsSats / 100) : 0
  const previewReadTimeLabel = formatReadingTimeLabel(post.reading_time_minutes)
  const canViewFullPost = unlocked || isAuthorSession || isAdminSession
  const showPaywall = !canViewFullPost && !unlockCheckPending

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white dark:bg-zinc-950">
      <Nav />
      <main className="mx-auto w-full max-w-3xl px-4 pt-8 pb-6 sm:pt-10">
        <article className="px-0 pb-4">
          {isAdminSession ? (
            <p className="mb-2">
              <button
                type="button"
                onClick={() => void handlePinHomepage()}
                disabled={pinBusy}
                className="text-xs font-medium text-amber-800 underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50 dark:text-amber-300 dark:hover:text-amber-200"
              >
                {pinBusy ? '…' : post.pinned === true ? '📌 Unpin' : '📌 Pin to homepage'}
              </button>
            </p>
          ) : null}
          <h1 className="font-article-title text-3xl sm:text-4xl font-medium leading-tight text-zinc-900 dark:text-zinc-50">
            {post.title}
          </h1>
          <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400">
            <span>By</span>
            {author?.display_handle?.trim() || author?.username?.trim() ? (
              <>
                <Link
                  href={
                    author?.display_handle?.trim()
                      ? `/@${encodeURIComponent(author.display_handle.trim())}`
                      : `/u/${encodeURIComponent(author.username.trim())}`
                  }
                  className="font-medium text-zinc-700 transition-colors hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
                >
                  {author.display_handle?.trim() || author.username.trim()}
                </Link>
                {readerWalletAddress.trim() && post.author_id && !isAuthorSession ? (
                  <button
                    type="button"
                    title={isFollowingAuthor ? undefined : 'Follow'}
                    aria-label={isFollowingAuthor ? 'Following author' : 'Follow author'}
                    onClick={() => void handleFollowAuthor()}
                    disabled={followAuthorBusy}
                    className={
                      followAuthorBusy
                        ? 'cursor-not-allowed rounded-full border border-zinc-200 bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-500'
                        : isFollowingAuthor
                          ? 'inline-flex shrink-0 items-center gap-0.5 rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-500 dark:bg-emerald-500 dark:text-emerald-950 dark:hover:bg-emerald-400'
                          : 'shrink-0 rounded-full border border-zinc-300 bg-white px-2 py-0.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800'
                    }
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
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              <time dateTime={articleDateIso}>{formatArticlePublishedDate(articleDateIso)}</time>
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleShareX}
              className="rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              𝕏
            </button>
            <button
              type="button"
              onClick={handleShareFacebook}
              className="rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Facebook
            </button>
            <button
              type="button"
              onClick={() => void handleCopyArticleLink()}
              className="rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Copy Link
            </button>
            {copiedShareLink ? (
              <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                Copied!
              </span>
            ) : null}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-500 dark:text-zinc-500">
            {post.reading_time_minutes ? (
              <span>{post.reading_time_minutes} min read</span>
            ) : null}
            <span className="flex items-center gap-1">
              🔓 <span>{unlockCount}</span>
            </span>

            <button
              type="button"
              onClick={() =>
                document.getElementById('comments')?.scrollIntoView({ behavior: 'smooth' })
              }
              className="flex items-center gap-1 border-0 bg-transparent p-0 font-inherit text-inherit transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              💬 <span>{commentCount}</span>
            </button>

            {earningsXec > 0 ? (
              <span className="flex items-center gap-1">
                💰 <span>{earningsXec.toLocaleString()}</span>
              </span>
            ) : null}
          </div>

          {unlockCheckPending && !canViewFullPost ? (
            <p className="mt-10 text-sm text-zinc-600 dark:text-zinc-400">Checking access...</p>
          ) : null}

          {showPaywall && hasPaywallMarker ? (
            <section className="mt-6 border-t border-zinc-100 pt-6 dark:border-zinc-800">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Preview
                {previewReadTimeLabel ? (
                  <span className="font-normal normal-case text-zinc-500 dark:text-zinc-400">
                    {' '}
                    ({previewReadTimeLabel})
                  </span>
                ) : null}
              </h2>
              <div className="mt-3">
                <div
                  className="prose prose-zinc dark:prose-invert max-w-none text-base"
                  dangerouslySetInnerHTML={{ __html: bodyHtml }}
                />

                <div className="pt-6 pb-6 text-center">
                  {bip21Url ? (
                    <>
                      <button
                        type="button"
                        disabled={payBusy}
                        onClick={handlePayToUnlock}
                        className="inline-flex w-full items-center justify-center rounded-lg px-4 py-3.5 text-sm font-semibold text-white transition-all duration-200 hover:scale-[1.01] hover:opacity-90 active:scale-[0.99] disabled:opacity-60 disabled:hover:scale-100"
                        style={{
                          background: 'linear-gradient(135deg, #059669 0%, #0d9488 100%)',
                          animation: 'glow-pulse 2.2s ease-in-out infinite',
                        }}
                      >
                        {payBusy
                          ? 'Opening wallet…'
                          : `Pay ${unlockPriceLabel} XEC to unlock`}
                      </button>
                      <p className="mt-1 text-center text-xs text-zinc-500 dark:text-zinc-500">
                        (6% of all unlock payments go to support the platform)
                      </p>
                      {pollingActive && paymentInitiated ? (
                        <div className="mt-4 rounded-lg border border-zinc-200 bg-white/70 px-4 py-3 text-left dark:border-zinc-700 dark:bg-zinc-900/60">
                          <div className="flex items-center gap-3">
                            <span
                              aria-hidden
                              className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-emerald-500 dark:border-zinc-600 dark:border-t-emerald-400"
                            />
                            <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                              Waiting for payment confirmation...
                            </p>
                          </div>
                          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                            This usually takes a few seconds
                          </p>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
                      Payment details are not configured for this post yet.
                    </p>
                  )}
                </div>
              </div>
            </section>
          ) : null}

          {canViewFullPost ? (
            <section className="mt-6 border-t border-zinc-100 pt-6 dark:border-zinc-800">
              <div
                className="prose prose-zinc dark:prose-invert max-w-none text-base"
                dangerouslySetInnerHTML={{
                  __html: bodyHtml,
                }}
              />

              <section
                id="comments"
                className="mt-10 border-t border-zinc-100 pt-8 dark:border-zinc-800"
              >
                <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                  Comments
                </h3>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                  {commentCount} {commentCount === 1 ? 'comment' : 'comments'}
                </p>

                <div className="mt-5">
                  <label
                    htmlFor="new-comment"
                    className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
                  >
                    Add a comment
                  </label>
                  <textarea
                    id="new-comment"
                    rows={4}
                    maxLength={COMMENT_MAX_LEN}
                    value={commentText}
                    onChange={(e) =>
                      setCommentText(e.target.value.slice(0, COMMENT_MAX_LEN))
                    }
                    className="mt-2 w-full resize-y rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-400 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:ring-zinc-500"
                    placeholder="Share your thoughts..."
                  />
                  <p
                    className={`mt-1 text-right text-xs tabular-nums ${charCounterClassName(commentText.length, COMMENT_MAX_LEN, COMMENT_WARN_WITHIN)}`}
                  >
                    {commentText.length}/{COMMENT_MAX_LEN}
                  </p>
                  <button
                    type="button"
                    onClick={() => void handlePostComment()}
                    disabled={commentSubmitting}
                    className="mt-3 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
                  >
                    {commentSubmitting ? 'Posting…' : 'Post Comment'}
                  </button>
                </div>

                {commentActionError ? (
                  <p className="mt-3 text-sm text-red-600 dark:text-red-400" role="alert">
                    {commentActionError}
                  </p>
                ) : null}

                {commentsError ? (
                  <p className="mt-4 text-sm text-red-600 dark:text-red-400" role="alert">
                    {commentsError}
                  </p>
                ) : null}

                {commentsLoading ? (
                  <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
                    Loading comments...
                  </p>
                ) : comments.length === 0 ? (
                  <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
                    No comments yet.
                  </p>
                ) : (
                  <ul className="mt-6 space-y-3">
                    {comments.map((comment) => {
                      const fullWalletAddress =
                        typeof comment.payer_address === 'string'
                          ? comment.payer_address.trim()
                          : ''
                      // Own comment if it matches this session's display identity
                      // (@handle) or either stored form of its address. Server
                      // enforces the real authorization on delete regardless.
                      const myAddr = (me?.address || '').trim()
                      const ownedIds = me
                        ? [
                            me.identity,
                            myAddr,
                            myAddr.startsWith('ecash:')
                              ? myAddr.slice('ecash:'.length)
                              : `ecash:${myAddr}`,
                          ].filter(Boolean)
                        : []
                      const canDelete =
                        isAuthorSession ||
                        (fullWalletAddress && ownedIds.includes(fullWalletAddress))
                      return (
                        <li
                          key={comment.id}
                          className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-950"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p
                                className="cursor-pointer break-all text-sm font-medium text-zinc-800 dark:text-zinc-200"
                                title={fullWalletAddress ? 'Click to copy' : undefined}
                                onClick={() => {
                                  if (!fullWalletAddress) return
                                  void handleCopyCommentWallet(comment.id, fullWalletAddress)
                                }}
                              >
                                {fullWalletAddress || 'Anonymous'}
                              </p>
                              {copiedCommentIds[comment.id] ? (
                                <p className="mt-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                                  Copied!
                                </p>
                              ) : null}
                              <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                                {formatCommentDate(comment.created_at)}
                              </p>
                            </div>
                            {canDelete ? (
                              <button
                                type="button"
                                onClick={() => void handleDeleteComment(comment.id)}
                                disabled={deletingCommentId === comment.id}
                                className="rounded-md border border-red-300 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 transition hover:bg-red-100 disabled:opacity-50 dark:border-red-800 dark:bg-red-950/60 dark:text-red-300 dark:hover:bg-red-950"
                              >
                                {deletingCommentId === comment.id ? 'Deleting…' : 'Delete'}
                              </button>
                            ) : null}
                          </div>
                          <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
                            {comment.content}
                          </p>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>
            </section>
          ) : null}

          {showPaywall && !hasPaywallMarker ? (
            <section className="mt-6 border-t border-zinc-100 pt-6 dark:border-zinc-800">
              {bodyHtml ? (
                <div
                  className="prose prose-zinc dark:prose-invert max-w-none text-base"
                  dangerouslySetInnerHTML={{ __html: bodyHtml }}
                />
              ) : null}
              <div className="mt-2 px-0 py-4">
              {bip21Url ? (
                <>
                  <button
                    type="button"
                    disabled={payBusy}
                    onClick={handlePayToUnlock}
                    className="inline-flex w-full items-center justify-center rounded-lg bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-60 dark:bg-emerald-400 dark:text-emerald-950"
                  >
                    {payBusy
                      ? 'Opening wallet…'
                      : `Pay ${unlockPriceLabel} XEC to unlock`}
                  </button>
                  <p className="mt-1 text-center text-xs text-zinc-500 dark:text-zinc-500">
                    (6% of all unlock payments go to support the platform)
                  </p>
                  {pollingActive && paymentInitiated ? (
                    <div className="mt-4 rounded-lg border border-zinc-200 bg-white/70 px-4 py-3 dark:border-zinc-700 dark:bg-zinc-900/60">
                      <div className="flex items-center gap-3">
                        <span
                          aria-hidden
                          className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-emerald-500 dark:border-zinc-600 dark:border-t-emerald-400"
                        />
                        <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                          Waiting for payment confirmation...
                        </p>
                      </div>
                      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                        This usually takes a few seconds
                      </p>
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
                  Payment details are not configured for this post yet.
                </p>
              )}
              </div>
            </section>
          ) : null}
        </article>
      </main>
    </div>
  )
}
