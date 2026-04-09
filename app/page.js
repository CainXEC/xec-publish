'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ThemeToggle from '@/components/ThemeToggle'
import { supabase } from '@/lib/supabase'

function formatXec(amount) {
  const n = Number(amount)
  if (!Number.isFinite(n)) return '0'
  return n.toFixed(8).replace(/\.?0+$/, '')
}

function formatPublishedDate(iso) {
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

function authorFromPost(post) {
  const a = post.authors
  if (!a) return null
  return Array.isArray(a) ? a[0] ?? null : a
}

function unlockCountFromPost(post) {
  const u = post.unlocks
  if (!u) return 0
  const row = Array.isArray(u) ? u[0] : u
  const c = row?.count
  const n = typeof c === 'number' ? c : Number(c)
  return Number.isFinite(n) ? n : 0
}

function commentCountFromPost(post) {
  const c = post.comments
  if (!c) return 0
  const row = Array.isArray(c) ? c[0] : c
  const count = row?.count
  const n = typeof count === 'number' ? count : Number(count)
  return Number.isFinite(n) ? n : 0
}

function sortPostsByUnlocksThenNewest(rows) {
  return [...rows].sort((a, b) => {
    const diff = unlockCountFromPost(b) - unlockCountFromPost(a)
    if (diff !== 0) return diff
    const ta = new Date(a.created_at).getTime()
    const tb = new Date(b.created_at).getTime()
    return tb - ta
  })
}

function sortPostsByNewest(rows) {
  return [...rows].sort((a, b) => {
    const tb = new Date(b.created_at).getTime()
    const ta = new Date(a.created_at).getTime()
    return tb - ta
  })
}

const sortBtnActive =
  'rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-500 md:px-4 md:py-2 md:text-sm dark:bg-emerald-500 dark:text-emerald-950 dark:hover:bg-emerald-400'
const sortBtnInactive =
  'rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-800 transition hover:bg-zinc-50 md:px-4 md:py-2 md:text-sm dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900'
const filterBtnActive =
  'rounded-lg bg-emerald-100 px-2 py-1 text-[11px] font-semibold text-emerald-800 shadow-sm transition hover:bg-emerald-200 md:px-3 md:py-1.5 md:text-xs dark:bg-emerald-900/50 dark:text-emerald-200 dark:hover:bg-emerald-900'
const filterBtnInactive =
  'rounded-lg border border-zinc-300 bg-white px-2 py-1 text-[11px] font-medium text-zinc-700 transition hover:bg-zinc-50 md:px-3 md:py-1.5 md:text-xs dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800'

function truncateAddress(address) {
  if (address == null || address === '') return ''
  const t = String(address).trim()
  if (!t) return ''
  if (t.length <= 13) return t
  return `${t.slice(0, 6)}...${t.slice(-4)}`
}

const TEASER_CARD_MAX = 500
function truncateTeaserPreview(text, maxLen = TEASER_CARD_MAX) {
  const s = text != null ? String(text) : ''
  if (s.length <= maxLen) return s
  return `${s.slice(0, maxLen)}...`
}

export default function HomePage() {
  const [fetchedPosts, setFetchedPosts] = useState([])
  const [sortMode, setSortMode] = useState('unlocks')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [authorLoggedIn, setAuthorLoggedIn] = useState(false)
  const [readerWalletAddress, setReaderWalletAddress] = useState('')
  const [readerUnlockedPostIds, setReaderUnlockedPostIds] = useState([])
  const [readerFilterMode, setReaderFilterMode] = useState('all')
  const [postSearchQuery, setPostSearchQuery] = useState('')
  const [readerLoginBusy, setReaderLoginBusy] = useState(false)
  const [readerLoginError, setReaderLoginError] = useState('')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const mobileNavRef = useRef(null)
  const latestTxPollRef = useRef(null)
  const baselineTxidRef = useRef('')
  const lastHandledTxidRef = useRef('')
  const platformAddress = useMemo(
    () => process.env.NEXT_PUBLIC_PLATFORM_XEC_ADDRESS?.trim() ?? '',
    [],
  )
  const platformAddressForLatestTx = useMemo(
    () => platformAddress.replace(/^ecash:/, ''),
    [platformAddress],
  )

  const posts = useMemo(() => {
    if (sortMode === 'newest') return sortPostsByNewest(fetchedPosts)
    return sortPostsByUnlocksThenNewest(fetchedPosts)
  }, [fetchedPosts, sortMode])

  const readerFilteredPosts = useMemo(() => {
    if (!readerWalletAddress || readerFilterMode === 'all') return posts
    const unlockedSet = new Set(readerUnlockedPostIds)
    if (readerFilterMode === 'unlocked') {
      return posts.filter((post) => unlockedSet.has(post.id))
    }
    return posts.filter((post) => !unlockedSet.has(post.id))
  }, [posts, readerFilterMode, readerUnlockedPostIds, readerWalletAddress])

  const trimmedPostSearch = postSearchQuery.trim()
  const displayPosts = useMemo(() => {
    if (!trimmedPostSearch) return readerFilteredPosts
    const q = trimmedPostSearch.toLowerCase()
    return readerFilteredPosts.filter((post) => {
      const title = String(post.title ?? '').toLowerCase()
      const teaser = String(post.teaser ?? '').toLowerCase()
      const author = authorFromPost(post)
      const username = String(author?.username ?? '').toLowerCase()
      return title.includes(q) || teaser.includes(q) || username.includes(q)
    })
  }, [readerFilteredPosts, trimmedPostSearch])

  const stopReaderTxPolling = useCallback(() => {
    if (latestTxPollRef.current) {
      clearInterval(latestTxPollRef.current)
      latestTxPollRef.current = null
    }
  }, [])

  const fetchReaderUnlocks = useCallback(async (walletAddress) => {
    if (!walletAddress) return []
    const res = await fetch(
      `/api/reader-unlocks?walletAddress=${encodeURIComponent(walletAddress)}`,
      { cache: 'no-store' },
    )
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(data?.error || 'Could not fetch reader unlocks')
    }
    return Array.isArray(data?.unlockedPostIds) ? data.unlockedPostIds : []
  }, [])

  const applyReaderWallet = useCallback(
    async (walletAddress, unlockedPostIdsFromVerify) => {
      setReaderWalletAddress(walletAddress)
      localStorage.setItem('readerWalletAddress', walletAddress)
      if (Array.isArray(unlockedPostIdsFromVerify)) {
        setReaderUnlockedPostIds(unlockedPostIdsFromVerify)
      } else {
        const ids = await fetchReaderUnlocks(walletAddress)
        setReaderUnlockedPostIds(ids)
      }
    },
    [fetchReaderUnlocks],
  )

  const startReaderLoginPolling = useCallback(async () => {
    if (!platformAddressForLatestTx) return
    stopReaderTxPolling()
    setReaderLoginBusy(true)
    setReaderLoginError('')
    try {
      const baselineRes = await fetch(
        `/api/latest-tx/${encodeURIComponent(platformAddressForLatestTx)}`,
        { cache: 'no-store' },
      )
      const baselineData = await baselineRes.json().catch(() => ({}))
      baselineTxidRef.current =
        baselineRes.ok && baselineData?.txid ? baselineData.txid : ''
    } catch {
      baselineTxidRef.current = ''
    }

    const checkLatest = async () => {
      try {
        const latestRes = await fetch(
          `/api/latest-tx/${encodeURIComponent(platformAddressForLatestTx)}`,
          { cache: 'no-store' },
        )
        const latestData = await latestRes.json().catch(() => ({}))
        const txid = latestRes.ok ? latestData?.txid : ''
        if (!txid) return
        if (txid === baselineTxidRef.current) return
        if (txid === lastHandledTxidRef.current) return
        lastHandledTxidRef.current = txid

        const verifyRes = await fetch('/api/verify-wallet-auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ txid }),
        })
        const verifyData = await verifyRes.json().catch(() => ({}))
        if (!verifyRes.ok || !verifyData?.walletAddress) {
          setReaderLoginError(
            verifyData?.error || 'Wallet verification failed. Try again.',
          )
          return
        }
        await applyReaderWallet(
          verifyData.walletAddress,
          verifyData.unlockedPostIds,
        )
        stopReaderTxPolling()
        setReaderLoginBusy(false)
      } catch {
        /* ignore transient polling errors */
      }
    }

    void checkLatest()
    latestTxPollRef.current = setInterval(() => {
      void checkLatest()
    }, 3000)
  }, [
    applyReaderWallet,
    platformAddressForLatestTx,
    stopReaderTxPolling,
  ])

  const handleReaderLogin = useCallback(() => {
    if (!platformAddressForLatestTx) {
      setReaderLoginError('Platform payment address is not configured.')
      return
    }
    const cashtabUrl = `https://cashtab.com/#/send?bip21=ecash:${platformAddressForLatestTx}?amount=5.5`
    window.open(cashtabUrl, '_blank', 'noopener,noreferrer')
    void startReaderLoginPolling()
  }, [platformAddressForLatestTx, startReaderLoginPolling])

  const handleReaderLogout = useCallback(() => {
    stopReaderTxPolling()
    localStorage.removeItem('readerWalletAddress')
    setReaderWalletAddress('')
    setReaderUnlockedPostIds([])
    setReaderFilterMode('all')
    setReaderLoginBusy(false)
    setReaderLoginError('')
    baselineTxidRef.current = ''
    lastHandledTxidRef.current = ''
  }, [stopReaderTxPolling])

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setLoadError(null)

      const { data: sessionData } = await supabase.auth.getSession()
      if (!cancelled) setAuthorLoggedIn(!!sessionData.session)

      const { data, error } = await supabase
        .from('posts')
        .select('*, authors(username), unlocks(count), comments(count)')
        .eq('published', true)

      if (cancelled) return

      if (error) {
        setLoadError(error.message)
        setFetchedPosts([])
      } else {
        setFetchedPosts(data ?? [])
      }
      setLoading(false)
    }

    load()

    try {
      const storedWalletAddress = localStorage.getItem('readerWalletAddress') || ''
      if (storedWalletAddress) {
        void applyReaderWallet(storedWalletAddress)
      }
    } catch {
      /* ignore localStorage errors */
    }

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthorLoggedIn(!!session)
    })

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
      stopReaderTxPolling()
    }
  }, [applyReaderWallet, stopReaderTxPolling])

  const closeMobileNav = useCallback(() => setMobileNavOpen(false), [])

  useEffect(() => {
    if (!mobileNavOpen) return
    function onKey(e) {
      if (e.key === 'Escape') setMobileNavOpen(false)
    }
    function onPointerDown(e) {
      if (
        mobileNavRef.current &&
        e.target instanceof Node &&
        !mobileNavRef.current.contains(e.target)
      ) {
        setMobileNavOpen(false)
      }
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onPointerDown)
    }
  }, [mobileNavOpen])

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(min-width: 768px)')
    function onChange() {
      if (mq.matches) setMobileNavOpen(false)
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const showPostSearch = !loading && !loadError && fetchedPosts.length > 0

  const searchInputClassName =
    'w-full rounded-md border border-zinc-300 bg-white py-1.5 pl-2 pr-7 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-1 focus:ring-zinc-400 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-50 dark:placeholder:text-zinc-500 dark:focus:ring-zinc-500'

  return (
    <div className="min-h-full flex-1 bg-zinc-50 dark:bg-zinc-950">
      <header
        ref={mobileNavRef}
        className="sticky top-0 z-30 border-b border-zinc-200/80 bg-white/90 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/90"
      >
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-2 px-4 md:px-6">
          <Link
            href="/"
            className="shrink-0 text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
          >
            XEC Publish
          </Link>

          <div className="hidden min-w-0 flex-1 items-center justify-between gap-3 md:flex">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <Link
                href="/leaderboard"
                className="shrink-0 text-sm font-medium text-zinc-700 transition hover:text-zinc-900 hover:underline dark:text-zinc-300 dark:hover:text-zinc-100"
              >
                Leaderboard
              </Link>
              {showPostSearch ? (
                <div className="relative min-w-0 md:w-52 lg:w-64">
                  <label htmlFor="post-search-desktop" className="sr-only">
                    Search posts
                  </label>
                  <input
                    id="post-search-desktop"
                    type="search"
                    value={postSearchQuery}
                    onChange={(e) => setPostSearchQuery(e.target.value)}
                    placeholder="Search…"
                    autoComplete="off"
                    className={`h-8 min-h-8 ${searchInputClassName}`}
                  />
                  {postSearchQuery ? (
                    <button
                      type="button"
                      onClick={() => setPostSearchQuery('')}
                      className="absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-base leading-none text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                      aria-label="Clear search"
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <ThemeToggle />
              {readerWalletAddress ? (
                <div className="flex flex-nowrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-800 whitespace-nowrap dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden />
                  <span
                    className="min-w-0 flex-1 truncate text-center font-mono"
                    title={readerWalletAddress}
                  >
                    {truncateAddress(readerWalletAddress)}
                  </span>
                  <button
                    type="button"
                    onClick={handleReaderLogout}
                    className="shrink-0 rounded px-1.5 py-0.5 text-zinc-700 transition hover:bg-emerald-100 hover:text-zinc-900 dark:text-emerald-100 dark:hover:bg-emerald-900"
                  >
                    Logout
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleReaderLogin}
                  disabled={readerLoginBusy}
                  className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200 dark:hover:bg-emerald-950"
                >
                  {readerLoginBusy ? 'Waiting for payment...' : 'Reader Login'}
                </button>
              )}
              {authorLoggedIn ? (
                <Link
                  href="/dashboard"
                  className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
                >
                  Dashboard
                </Link>
              ) : (
                <div className="flex items-center gap-5">
                  <Link
                    href="/login"
                    className="text-sm font-medium text-zinc-700 transition hover:text-zinc-900 hover:underline dark:text-zinc-300 dark:hover:text-zinc-100"
                  >
                    Author Login
                  </Link>
                  <Link
                    href="/signup"
                    className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 dark:bg-emerald-500 dark:hover:bg-emerald-400"
                  >
                    Start Writing
                  </Link>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 md:hidden">
            <ThemeToggle />
            <button
              type="button"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-300 bg-white text-lg leading-none text-zinc-800 transition hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
              aria-expanded={mobileNavOpen}
              aria-controls="mobile-nav-menu"
              onClick={() => setMobileNavOpen((o) => !o)}
            >
              <span aria-hidden>☰</span>
              <span className="sr-only">{mobileNavOpen ? 'Close menu' : 'Open menu'}</span>
            </button>
          </div>
        </div>

        <div
          id="mobile-nav-menu"
          className={`border-t border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-950 md:hidden ${
            mobileNavOpen ? 'block' : 'hidden'
          }`}
        >
          <nav
            className="mx-auto max-w-5xl space-y-4 px-4 py-4"
            aria-label="Mobile navigation"
          >
            {showPostSearch ? (
              <div className="relative w-full">
                <label htmlFor="post-search-mobile" className="sr-only">
                  Search posts
                </label>
                <input
                  id="post-search-mobile"
                  type="search"
                  value={postSearchQuery}
                  onChange={(e) => setPostSearchQuery(e.target.value)}
                  placeholder="Search title, teaser, or author…"
                  autoComplete="off"
                  className={`min-h-10 ${searchInputClassName}`}
                />
                {postSearchQuery ? (
                  <button
                    type="button"
                    onClick={() => setPostSearchQuery('')}
                    className="absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-base leading-none text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                    aria-label="Clear search"
                  >
                    ×
                  </button>
                ) : null}
              </div>
            ) : null}

            <div className="flex flex-col gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
              {readerWalletAddress ? (
                <button
                  type="button"
                  onClick={() => {
                    handleReaderLogout()
                    closeMobileNav()
                  }}
                  title={readerWalletAddress}
                  className="flex w-full flex-nowrap items-center justify-between gap-2 whitespace-nowrap rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-left text-xs font-medium text-emerald-800 transition hover:bg-emerald-100 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200 dark:hover:bg-emerald-900/50"
                >
                  <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-center font-mono">
                    {truncateAddress(readerWalletAddress)}
                  </span>
                  <span className="shrink-0 text-zinc-700 dark:text-emerald-100">Logout</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    handleReaderLogin()
                    closeMobileNav()
                  }}
                  disabled={readerLoginBusy}
                  className="w-full rounded-lg border border-emerald-300 bg-emerald-50 py-2.5 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200 dark:hover:bg-emerald-950"
                >
                  {readerLoginBusy ? 'Waiting for payment...' : 'Reader Login'}
                </button>
              )}
            </div>

            <div className="flex flex-col gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
              {authorLoggedIn ? (
                <Link
                  href="/dashboard"
                  onClick={closeMobileNav}
                  className="block rounded-lg bg-zinc-900 py-2.5 text-center text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
                >
                  Dashboard
                </Link>
              ) : (
                <>
                  <Link
                    href="/login"
                    onClick={closeMobileNav}
                    className="block rounded-lg border border-zinc-300 bg-white py-2.5 text-center text-sm font-medium text-zinc-800 transition hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  >
                    Author Login
                  </Link>
                  <Link
                    href="/signup"
                    onClick={closeMobileNav}
                    className="block rounded-lg bg-emerald-600 py-2.5 text-center text-sm font-semibold text-white transition hover:bg-emerald-500 dark:bg-emerald-500 dark:hover:bg-emerald-400"
                  >
                    Start Writing
                  </Link>
                </>
              )}
            </div>

            <div className="border-t border-zinc-200 pt-4 dark:border-zinc-800">
              <Link
                href="/leaderboard"
                onClick={closeMobileNav}
                className="block w-full rounded-lg border border-zinc-300 bg-white py-2.5 text-center text-sm font-medium text-zinc-800 transition hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                Leaderboard
              </Link>
            </div>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="mb-10 max-w-2xl">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-4xl">
            Latest articles
          </h1>
          <p className="mt-3 text-base leading-relaxed text-zinc-600 dark:text-zinc-400">
            Paid posts from independent writers. Pay with XEC to unlock the full story.
          </p>
        </div>

        {loading ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Loading posts…</p>
        ) : loadError ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-6 dark:border-red-900/50 dark:bg-red-950/40">
            <p className="text-sm text-red-800 dark:text-red-200">{loadError}</p>
          </div>
        ) : fetchedPosts.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-300 bg-white/60 px-8 py-16 text-center dark:border-zinc-700 dark:bg-zinc-900/40">
            <p className="text-lg text-zinc-700 dark:text-zinc-300">
              No posts yet. Be the first to write something.
            </p>
          </div>
        ) : (
          <>
            <div className="mb-6 flex flex-wrap gap-1.5 md:gap-2" role="group" aria-label="Sort posts">
              <button
                type="button"
                aria-pressed={sortMode === 'unlocks'}
                onClick={() => setSortMode('unlocks')}
                className={sortMode === 'unlocks' ? sortBtnActive : sortBtnInactive}
              >
                🔓 Most Unlocked
              </button>
              <button
                type="button"
                aria-pressed={sortMode === 'newest'}
                onClick={() => setSortMode('newest')}
                className={sortMode === 'newest' ? sortBtnActive : sortBtnInactive}
              >
                🕐 Newest First
              </button>
            </div>
            {readerLoginError ? (
              <p className="mb-4 text-sm text-red-700 dark:text-red-300">{readerLoginError}</p>
            ) : null}
            {readerWalletAddress ? (
              <div className="mb-6 flex flex-wrap gap-1.5 md:gap-2" role="group" aria-label="Filter posts">
                <button
                  type="button"
                  aria-pressed={readerFilterMode === 'all'}
                  onClick={() => setReaderFilterMode('all')}
                  className={readerFilterMode === 'all' ? filterBtnActive : filterBtnInactive}
                >
                  All Posts
                </button>
                <button
                  type="button"
                  aria-pressed={readerFilterMode === 'unlocked'}
                  onClick={() => setReaderFilterMode('unlocked')}
                  className={readerFilterMode === 'unlocked' ? filterBtnActive : filterBtnInactive}
                >
                  Unlocked
                </button>
                <button
                  type="button"
                  aria-pressed={readerFilterMode === 'locked'}
                  onClick={() => setReaderFilterMode('locked')}
                  className={readerFilterMode === 'locked' ? filterBtnActive : filterBtnInactive}
                >
                  Locked
                </button>
              </div>
            ) : null}
            {displayPosts.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-zinc-300 bg-white/60 px-8 py-12 text-center dark:border-zinc-700 dark:bg-zinc-900/40">
                <p className="text-sm text-zinc-700 dark:text-zinc-300">
                  {trimmedPostSearch && readerFilteredPosts.length > 0
                    ? `No posts found for '${trimmedPostSearch}'`
                    : 'No posts match this filter.'}
                </p>
              </div>
            ) : null}
            {displayPosts.length > 0 ? (
            <ul className="flex flex-col gap-6">
            {displayPosts.map((post) => {
              const author = authorFromPost(post)
              const username = author?.username?.trim() || 'Unknown'
              const postHref = `/posts/${encodeURIComponent(post.slug)}`
              const priceLabel = formatXec(post.price_xec)
              const unlocksN = unlockCountFromPost(post)
              const commentsN = commentCountFromPost(post)
              const unlockStat =
                unlocksN === 1 ? '🔓 1 unlock' : `🔓 ${unlocksN} unlocks`
              const commentStat =
                commentsN === 1 ? '💬 1 comment' : `💬 ${commentsN} comments`

              return (
                <li key={post.id}>
                  <Link
                    href={postHref}
                    className="block rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm transition-[box-shadow,border-color] duration-200 hover:border-zinc-400 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-500 dark:hover:shadow-lg/20 dark:focus-visible:ring-offset-zinc-950"
                  >
                    <h2 className="text-xl font-semibold leading-snug text-zinc-900 dark:text-zinc-50">
                      {post.title}
                    </h2>
                    <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-zinc-500 dark:text-zinc-400">
                      <span className="font-medium text-zinc-700 dark:text-zinc-300">
                        {username}
                      </span>
                      <span aria-hidden className="text-zinc-300 dark:text-zinc-600">
                        ·
                      </span>
                      <time dateTime={post.created_at ?? undefined}>
                        {formatPublishedDate(post.created_at)}
                      </time>
                    </p>
                    <p className="mt-4 whitespace-pre-wrap text-base leading-relaxed text-zinc-600 dark:text-zinc-400">
                      {truncateTeaserPreview(post.teaser)}
                    </p>
                    <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                      <span>{priceLabel} XEC</span>
                      <span className="font-normal text-zinc-600 dark:text-zinc-400">
                        {unlockStat}
                      </span>
                      <span className="font-normal text-zinc-600 dark:text-zinc-400">
                        {commentStat}
                      </span>
                    </p>
                  </Link>
                </li>
              )
            })}
            </ul>
            ) : null}
          </>
        )}
      </main>
    </div>
  )
}
