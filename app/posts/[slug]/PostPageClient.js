'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import ActivityRail from '@/components/feed/ActivityRail'
import ArticleRail from '@/components/feed/ArticleRail'
import FeedTopbar from '@/components/feed/FeedTopbar'
import ArticleComments from '@/components/ArticleComments'
import TranslateButton from '@/components/TranslateButton'
import { setTranslation, setArticleIntent } from '@/lib/translateStore'
import { fetchTranslation } from '@/lib/translateClient'
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

// Server and client must render the SAME text on first paint, or React throws
// a hydration mismatch (#418): the server runs in UTC, the browser in the
// visitor's local zone, so an un-pinned toLocaleString disagrees on the
// hour/minute. We pin the timezone explicitly. `localZone=false` (the default,
// used for SSR + the first client render) formats in UTC so both sides match;
// after mount the byline re-renders with the reader's local zone.
function formatArticlePublishedDate(iso, localZone = false) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: localZone ? undefined : 'UTC',
    timeZoneName: 'short',
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
  // Default true: absent → treat as a normal paywall (reveals hidden writing),
  // so the "unlock only grants comments" copy shows only when we KNOW nothing
  // is locked.
  hasLockedContent = true,
  initialAuthor,
  initialAuthorAccountId = null,
  initialUnlockCount,
  initialCommentCount,
  slug = '',
}) {
  const router = useRouter()
  const [post] = useState(initialPost)
  const [author] = useState(initialAuthor)
  // The author's account id — the followee key for the account-keyed follow
  // graph (feed_follows). Both the follow-state read and the toggle go through
  // the session-authed /api/feed/* endpoints, so the viewer is derived from the
  // pow_session cookie server-side and can never be spoofed from the body.
  const [authorAccountId] = useState(initialAuthorAccountId)
  const [bodyHtml, setBodyHtml] = useState(initialBodyHtml ?? '')
  // AI translation ({ translated: html, title }); null = original.
  const [tr, setTr] = useState(null)

  const [unlocked, setUnlocked] = useState(initialUnlocked)

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
  // Fires the unlock chime + refresh exactly once. The 1.2s poll tick and the
  // Chronik websocket can both reach the "unlocked" branch in the same instant
  // (and a Pocket-paid unlock skips the txid dedupe), so without this latch each
  // would ding. Re-armed at the start of every attempt (startPayTxAutoVerify).
  const paySettledRef = useRef(false)
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
  // Gates the byline timestamp from its SSR-safe UTC render up to the reader's
  // local timezone once we're on the client (see formatArticlePublishedDate).
  const [mounted, setMounted] = useState(false)
  const shareCopyTimeoutRef = useRef(null)

  // Author / admin identity now comes from the wallet session (/api/me), not
  // Supabase. Derived each render so it tracks the session automatically once
  // /api/me resolves. canViewFullPost keys off this, so an author bypasses the
  // paywall on their OWN post with no separate auto-unlock needed. Admins are
  // NOT exempt — they pay to unlock like every other reader.
  const isAuthorSession = Boolean(
    me?.authorId && post?.author_id && me.authorId === post.author_id,
  )

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    setBodyHtml(initialBodyHtml ?? '')
  }, [initialBodyHtml])

  useEffect(() => {
    setUnlocked(initialUnlocked)
  }, [initialUnlocked])

  // After an unlock, re-translate the FULL body. The reader translated the public
  // preview, so `tr` covers only the public bytes; once the full body reveals, that
  // stale short translation would hide the rest and the unlock looks empty ("waiting
  // for the translation"). Show the untranslated full body immediately, then swap in
  // a fresh full-scope translation when it lands.
  const trRef = useRef(tr)
  useEffect(() => {
    trRef.current = tr
  }, [tr])
  const prevUnlockedRef = useRef(unlocked)
  useEffect(() => {
    const was = prevUnlockedRef.current
    prevUnlockedRef.current = unlocked
    if (was || !unlocked) return
    const lang = trRef.current?.lang
    if (!lang) return
    setTr(null) // reveal the full body now — no stale preview, no blank wait
    let cancelled = false
    void fetchTranslation('article', slug, lang).then((d) => {
      if (cancelled || !d) return
      setTr(d)
      setTranslation('article', slug, d) // keep in-memory + durable stores in sync
      setArticleIntent(slug, { lang, title: d.title }) // with the full-scope result
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked, slug])

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

  // Read the viewer's follow state from the account-keyed feed graph. The
  // session-authed viewer-state endpoint resolves "who am I" from the cookie, so
  // no wallet/author is sent from the client. Not signed in → returns empty.
  useEffect(() => {
    const viewerAccountId = me?.accountId
    if (!viewerAccountId || !authorAccountId) {
      setIsFollowingAuthor(false)
      return
    }
    let cancelled = false
    fetch('/api/feed/viewer-state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({ authorIds: [authorAccountId] }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) {
          setIsFollowingAuthor(
            Array.isArray(data?.followed) && data.followed.includes(authorAccountId),
          )
        }
      })
      .catch(() => {
        if (!cancelled) setIsFollowingAuthor(false)
      })
    return () => {
      cancelled = true
    }
  }, [me?.accountId, authorAccountId])

  const handleFollowAuthor = useCallback(async () => {
    if (!me?.accountId || !authorAccountId || followAuthorBusy) return
    setFollowAuthorBusy(true)
    try {
      const res = await fetch('/api/feed/follow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ followeeAccountId: authorAccountId }),
      })
      const data = await res.json().catch(() => ({}))
      if (data?.ok) setIsFollowingAuthor(data.following ?? false)
    } catch {
      /* ignore */
    } finally {
      setFollowAuthorBusy(false)
    }
  }, [authorAccountId, followAuthorBusy, me?.accountId])

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

  // Paint the now-entitled full body without a router.refresh() SSR round-trip.
  //   - Fast path: the pay flow's verify-payment response carries the full body
  //     inline; pass it here and it paints in the same tick (no network at all).
  //   - Fallback: the other unlock paths (initial address/cookie check, "already
  //     used" recovery) have no inline body, so re-read the reader route, which
  //     returns the full body now that the unlock cookie/session is set.
  // Best-effort either way — on failure the paywall just stays until the next
  // check, rather than flashing stale preview text.
  const revealFullBody = useCallback(async (inlineHtml) => {
    if (typeof inlineHtml === 'string' && inlineHtml) {
      setBodyHtml(inlineHtml)
      return
    }
    if (!slug) return
    try {
      const res = await fetch(`/api/posts/reader/${encodeURIComponent(slug)}`, {
        cache: 'no-store',
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.unlocked && typeof data.bodyHtml === 'string') {
        setBodyHtml(data.bodyHtml)
      }
    } catch {
      /* leave the preview in place; the next check re-attempts */
    }
  }, [slug])

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
        void revealFullBody()
        router.refresh()
        return true
      }
    } catch {
      // Network blip — treat as "not unlocked" so the caller shows the paywall.
      // The polling checks re-run, so a transient failure self-heals.
    }
    return false
  }, [router, revealFullBody])

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

  // Cross-device unlock paint: if this account's proven address has unlocked
  // this post (per /api/me), reveal it without needing the per-device cookie.
  useEffect(() => {
    if (!post?.id || unlocked) return
    if (Array.isArray(me?.unlockedPostIds) && me.unlockedPostIds.includes(post.id)) {
      setUnlocked(true)
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
    // Re-arm the settle latch so this attempt's unlock success can fire once.
    paySettledRef.current = false

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

    const checkLatest = async (pushedTxid) => {
      try {
        // Pocket-paid: the txid is known — verify it directly, skip the scan.
        let latestTxid = payPocketTxidRef.current
        if (!latestTxid) {
          // Websocket fast path: the Chronik push already carries the exact txid,
          // so verify it directly and skip the /api/latest-tx scan — one fewer
          // Chronik round-trip per nudge. The interval poll passes no txid and
          // still scans, so a missed push is always covered.
          if (pushedTxid) {
            latestTxid = pushedTxid
          } else {
            const latestTxRes = await fetch(
              `/api/latest-tx/${encodeURIComponent(authorAddressForLatestTx)}`,
            )
            const latestTxData = await latestTxRes.json().catch(() => ({}))
            latestTxid = latestTxRes.ok ? latestTxData.txid : ''
          }
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
          // Settle once — the poll tick and the websocket can both land here.
          if (paySettledRef.current) return
          paySettledRef.current = true
          triggerPaywallUnlockEffect()
          setPaymentFinalizing(false)
          setUnlocked(true)
          setPollingActive(false)
          // Paint the entitled text in this same tick. verify-payment now returns
          // the full body inline, so revealFullBody() paints with zero network and
          // there's no second round-trip / stale-preview flash. (Falls back to the
          // reader-route fetch only if the inline body was somehow absent.) No
          // router.refresh() — it was a duplicate reveal that raced this one.
          void revealFullBody(verifyData.bodyHtml)
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
            if (paySettledRef.current) return
            paySettledRef.current = true
            triggerPaywallUnlockEffect()
            setPaymentFinalizing(false)
            setUnlocked(true)
            setPollingActive(false)
            // No inline body on this recovery path (check-unlock only reports
            // entitlement), so revealFullBody() fetches the reader route once.
            // No router.refresh() — it was a duplicate reveal.
            void revealFullBody()
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
      (txid) => { void checkLatest(txid) },
      () => { void checkLatest() },
    )
  }, [
    authorAddressForLatestTx,
    fetchUnlockCount,
    persistReaderAfterPaywallUnlock,
    post?.id,
    revealFullBody,
    triggerPaywallUnlockEffect,
  ])

  if (!post) {
    return null
  }

  const articleDateIso = post.published_at ?? post.created_at
  const previewReadTimeLabel = formatReadingTimeLabel(post.reading_time_minutes)
  const canViewFullPost = unlocked || isAuthorSession
  // Paint from the SERVER's entitlement immediately — the SSR body already
  // reflects the same cookie the initial client re-check reads, so gating the
  // preview on that redundant round-trip only made every reader wait on a blank
  // "Checking access…". The address-based checks (below, via /api/me + polling)
  // still upgrade a cross-device unlock to the full story when they land.
  const showPaywall = !canViewFullPost

  // The paywall card — mirrors the in-pane reader's PaneUnlock look (.hr-*): a
  // bordered card with "The rest is for readers.", an inline green Unlock button,
  // and the 94/6 note. Same markup for both paywall placements below (preview vs
  // no-marker); the article page keeps its own payment loop (handlePayToUnlock).
  const payInFlight = payBusy || (pollingActive && paymentInitiated)
  // When the author locked nothing, unlocking only grants commenting — say so
  // plainly instead of promising "the rest of the story".
  const commentsOnlyUnlock = !hasLockedContent
  const paywallCard = (
    <div className="hr-paywall">
      <p className="hr-lockline">
        {commentsOnlyUnlock
          ? "You've read the entire story."
          : 'The rest is for readers.'}
      </p>
      {!bip21Url ? (
        <p className="hr-note">Payment details are not configured for this post yet.</p>
      ) : payInFlight ? (
        <>
          <p className="hr-watching">
            {paymentFinalizing
              ? 'Payment seen — finalizing on eCash…'
              : payBusy && !pollingActive
                ? 'Opening your wallet…'
                : 'Waiting for your payment…'}
          </p>
          <p className="hr-note">
            {paymentFinalizing
              ? 'Almost there — confirming Avalanche finality.'
              : 'Approve the payment — the story opens right here in a few seconds.'}
          </p>
        </>
      ) : (
        <>
          <button
            type="button"
            className="hr-unlock"
            disabled={payBusy}
            onClick={handlePayToUnlock}
          >
            {commentsOnlyUnlock ? 'Unlock comments' : 'Unlock'} · {unlockPriceLabel} XEC
          </button>
          <p className="hr-note">
            {commentsOnlyUnlock
              ? 'Unlock to join the discussion. 94% to the writer · 6% to the platform.'
              : '94% to the writer · 6% to the platform. The story opens right here.'}
          </p>
        </>
      )}
    </div>
  )

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
            {/* Byline = the account's live display identity, matching the rest
                of the site: bound handle, else the raw eCash address (shortened).
                The legacy authors.username is a LAST resort only for a walletless
                legacy import — never shown when the author has an address, so a
                wallet author with no handle reads as their address, not a stale
                imported name. The /@identifier route resolves handles AND bare
                addresses. */}
            {author?.display_handle?.trim() || authorXecAddress || author?.username?.trim() ? (
              <>
                <Link
                  href={
                    author?.display_handle?.trim()
                      ? `/@${encodeURIComponent(author.display_handle.trim())}`
                      : authorXecAddress
                        ? `/@${encodeURIComponent(authorXecAddress)}`
                        : `/u/${encodeURIComponent(author.username.trim())}`
                  }
                  className="bylink"
                  title={
                    !author?.display_handle?.trim() && authorXecAddress
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
                    (authorXecAddress
                      ? `${authorXecAddress.slice(0, 8)}…${authorXecAddress.slice(-4)}`
                      : author?.username?.trim())}
                </Link>
                {author?.is_ai ? (
                  <span className="aibadge" title="AI-operated account">
                    [AI]
                  </span>
                ) : null}
                {me?.accountId && authorAccountId && !isAuthorSession ? (
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
                      <span aria-hidden>✓</span>
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
              <time dateTime={articleDateIso} suppressHydrationWarning>
                {formatArticlePublishedDate(articleDateIso, mounted)}
              </time>
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

          {showPaywall && hasPaywallMarker ? (
            <section className="section">
              {/* Only a genuine preview when writing is actually locked; if the
                  author locked nothing, this IS the whole post — no "Preview". */}
              {hasLockedContent ? (
                <h2 className="preview-head">
                  Preview
                  {previewReadTimeLabel ? (
                    <span className="preview-time"> ({previewReadTimeLabel})</span>
                  ) : null}
                </h2>
              ) : null}
              <div
                className="prose"
                dangerouslySetInnerHTML={{ __html: tr?.translated ?? bodyHtml }}
              />

              {paywallCard}
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
              {paywallCard}
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
