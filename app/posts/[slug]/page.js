'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import Nav from '@/components/Nav'
import { buildPaywallBip21, computePaymentSplit } from '@/lib/paymentSplit'
import { sanitizePostBodyHtml } from '@/lib/sanitizePostBodyHtml'
import { supabase } from '@/lib/supabase-browser'

function truncateWallet(address) {
  if (!address || typeof address !== 'string') return 'Anonymous'
  const trimmed = address.trim()
  if (!trimmed) return 'Anonymous'
  if (trimmed.length <= 16) return trimmed
  return `${trimmed.slice(0, 10)}...${trimmed.slice(-4)}`
}

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
  const [paymentInitiated, setPaymentInitiated] = useState(false)
  const payTxPollRef = useRef(null)
  const payBaselineTxidRef = useRef('')
  const payLastHandledTxidRef = useRef('')

  const [commentCount, setCommentCount] = useState(0)
  const [unlockCount, setUnlockCount] = useState(0)
  const [comments, setComments] = useState([])
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [commentsError, setCommentsError] = useState(null)
  const [commentText, setCommentText] = useState('')
  const [commentSubmitting, setCommentSubmitting] = useState(false)
  const [commentActionError, setCommentActionError] = useState(null)
  const [deletingCommentId, setDeletingCommentId] = useState(null)
  const [isAuthorSession, setIsAuthorSession] = useState(false)
  const [authorAccessToken, setAuthorAccessToken] = useState('')

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

    let cancelled = false

    async function initialUnlock() {
      setUnlockCheckPending(true)
      let ok = await checkUnlock(post.id)
      if (!ok && typeof window !== 'undefined') {
        const storedWallet = (
          localStorage.getItem('readerWalletAddress') || ''
        ).trim()
        if (storedWallet) {
          ok = await checkUnlock(post.id, storedWallet)
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
    function onReaderLoggedOut() {
      setUnlocked(false)
    }
    window.addEventListener('readerLoggedOut', onReaderLoggedOut)
    return () => {
      window.removeEventListener('readerLoggedOut', onReaderLoggedOut)
    }
  }, [])

  useEffect(() => {
    if (!post?.id) return
    void fetchCommentCount(post.id)
    void fetchUnlockCount(post.id)
  }, [post?.id, fetchCommentCount, fetchUnlockCount])

  useEffect(() => {
    if (!post?.author_id) return
    let cancelled = false
    async function loadAuthorSessionState() {
      const { data: sessionData } = await supabase.auth.getSession()
      if (cancelled) return
      const session = sessionData?.session
      const userId = session?.user?.id
      setIsAuthorSession(Boolean(userId && userId === post.author_id))
      setAuthorAccessToken(session?.access_token ?? '')
    }
    void loadAuthorSessionState()
    return () => {
      cancelled = true
    }
  }, [post?.author_id])

  useEffect(() => {
    if (!post?.id || !unlocked) return
    void fetchComments(post.id)
  }, [post?.id, unlocked, fetchComments])

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
      const storedWallet =
        typeof window !== 'undefined'
          ? (localStorage.getItem('readerWalletAddress') || '').trim()
          : ''
      void checkUnlock(post.id, storedWallet || undefined)
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
      const storedWallet =
        typeof window !== 'undefined'
          ? (localStorage.getItem('readerWalletAddress') || '').trim()
          : ''
      void checkUnlock(post.id, storedWallet || undefined)
      setPollingActive(true)
    }

    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [post?.id, unlocked, checkUnlock])

  useEffect(() => {
    return () => {
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
        )
      : ''
  const cashtabUrl = bip21Url
    ? `https://cashtab.com/#/send?bip21=${bip21Url}`
    : ''
  const unlockPriceLabel = Number(priceXec).toLocaleString()

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
    setPaymentInitiated(true)
    setPollingActive(true)
    setPayBusy(true)
    openCashtab(cashtabUrl)
    void startPayTxAutoVerify()
    setPayBusy(false)
  }

  const persistReaderAfterPaywallUnlock = useCallback(
    async (confirmedTxid) => {
      if (
        typeof window === 'undefined' ||
        !authorAddressForLatestTx ||
        !confirmedTxid
      ) {
        return
      }

      let txidForWallet = confirmedTxid
      try {
        const latestRes = await fetch(
          `/api/latest-tx/${encodeURIComponent(authorAddressForLatestTx)}`,
        )
        const latestData = await latestRes.json().catch(() => ({}))
        if (latestRes.ok && latestData.txid) {
          txidForWallet = latestData.txid
        }
      } catch {
        /* keep confirmedTxid */
      }

      const tryVerifyWallet = async (txid) => {
        const verifyWalletRes = await fetch('/api/verify-wallet-auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ txid }),
        })
        const verifyWalletData = await verifyWalletRes.json().catch(() => ({}))
        return { verifyWalletRes, verifyWalletData }
      }

      let { verifyWalletRes, verifyWalletData } = await tryVerifyWallet(
        txidForWallet,
      )
      if (
        (!verifyWalletRes.ok || !verifyWalletData.walletAddress) &&
        txidForWallet !== confirmedTxid
      ) {
        ;({ verifyWalletRes, verifyWalletData } =
          await tryVerifyWallet(confirmedTxid))
      }

      const walletAddress = verifyWalletData.walletAddress?.trim?.() || ''
      if (!verifyWalletRes.ok || !walletAddress) {
        return
      }

      try {
        localStorage.setItem('readerWalletAddress', walletAddress)
      } catch {
        /* ignore quota / private mode */
      }

      window.dispatchEvent(
        new CustomEvent('readerLoggedIn', {
          detail: { walletAddress },
        }),
      )
    },
    [authorAddressForLatestTx],
  )

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
          void persistReaderAfterPaywallUnlock(latestTxid)
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
            setUnlocked(true)
            setPollingActive(false)
            if (payTxPollRef.current) {
              clearInterval(payTxPollRef.current)
              payTxPollRef.current = null
            }
            void persistReaderAfterPaywallUnlock(latestTxid)
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
  ])

  const handlePostComment = useCallback(async () => {
    if (!post?.id || !unlocked) return
    const content = commentText.trim()
    if (!content) {
      setCommentActionError('Comment content is required.')
      return
    }
    setCommentSubmitting(true)
    setCommentActionError(null)
    try {
      const payerAddress =
        typeof window !== 'undefined'
          ? (localStorage.getItem('readerWalletAddress') || '').trim()
          : ''

      const res = await fetch(`/api/comments/${encodeURIComponent(post.id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          payer_address: payerAddress || undefined,
        }),
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
  }, [commentText, fetchCommentCount, fetchComments, post?.id, unlocked])

  const handleDeleteComment = useCallback(async (commentId) => {
    if (!post?.id || !commentId) return
    setDeletingCommentId(commentId)
    setCommentActionError(null)
    try {
      const payerAddress =
        typeof window !== 'undefined'
          ? (localStorage.getItem('readerWalletAddress') || '').trim()
          : ''
      const headers = { 'Content-Type': 'application/json' }
      if (authorAccessToken) {
        headers.Authorization = `Bearer ${authorAccessToken}`
      }
      const res = await fetch(`/api/comments/${encodeURIComponent(post.id)}`, {
        method: 'DELETE',
        headers,
        body: JSON.stringify({
          commentId,
          payer_address: payerAddress || undefined,
          isAuthor: isAuthorSession,
        }),
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
    authorAccessToken,
    fetchCommentCount,
    fetchComments,
    isAuthorSession,
    post?.id,
  ])

  if (loadingPost) {
    return (
      <div className="flex min-h-full flex-1 flex-col bg-zinc-50 dark:bg-zinc-950">
        <Nav />
        <div className="flex flex-1 items-center justify-center px-4 py-16">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Loading post...</p>
        </div>
      </div>
    )
  }

  if (loadError || !post) {
    return (
      <div className="flex min-h-full flex-1 flex-col bg-zinc-50 dark:bg-zinc-950">
        <Nav />
        <div className="flex flex-1 items-center justify-center px-4 py-16">
          <div className="w-full max-w-2xl rounded-xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">404 - Post not found</h1>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              This post does not exist or is not published yet.
            </p>
          </div>
        </div>
      </div>
    )
  }

  const showPaywall = !unlocked && !unlockCheckPending

  return (
    <div className="flex min-h-full flex-1 flex-col bg-zinc-50 dark:bg-zinc-950">
      <Nav />
      <main className="mx-auto w-full max-w-3xl px-4 py-10">
        <article className="rounded-xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
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
          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-zinc-600 dark:text-zinc-400">
            <span>
              🔓 {unlockCount} {unlockCount === 1 ? 'unlock' : 'unlocks'}
            </span>
            <span aria-hidden className="text-zinc-300 dark:text-zinc-600">
              ·
            </span>
            <span>
              💬 {commentCount} {commentCount === 1 ? 'comment' : 'comments'}
            </span>
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
              <div
                className="article-body-html text-base text-zinc-800 dark:text-zinc-200"
                dangerouslySetInnerHTML={{
                  __html: sanitizePostBodyHtml(post.body ?? ''),
                }}
              />

              <section className="mt-10 border-t border-zinc-200 pt-8 dark:border-zinc-700">
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
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    className="mt-2 w-full resize-y rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-400 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:ring-zinc-500"
                    placeholder="Share your thoughts..."
                  />
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
                      const localWallet =
                        typeof window !== 'undefined'
                          ? (localStorage.getItem('readerWalletAddress') || '').trim()
                          : ''
                      const canDelete =
                        isAuthorSession ||
                        (localWallet &&
                          comment.payer_address &&
                          localWallet === comment.payer_address)
                      return (
                        <li
                          key={comment.id}
                          className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-950"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                                {truncateWallet(comment.payer_address)}
                              </p>
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

          {showPaywall ? (
            <section className="mt-10 rounded-xl border border-zinc-200 bg-zinc-50 p-6 dark:border-zinc-700 dark:bg-zinc-950">
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
                    (6% of payment goes to support the platform)
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
            </section>
          ) : null}
        </article>
      </main>
    </div>
  )
}
