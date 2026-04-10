'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ThemeToggle from '@/components/ThemeToggle'
import { supabase } from '@/lib/supabase-browser'

function truncateAddress(address) {
  if (address == null || address === '') return ''
  const t = String(address).trim()
  if (!t) return ''
  if (t.length <= 13) return t
  return `${t.slice(0, 6)}...${t.slice(-4)}`
}

const searchInputClassName =
  'w-full rounded-md border border-zinc-300 bg-white py-1.5 pl-2 pr-7 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-1 focus:ring-zinc-400 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-50 dark:placeholder:text-zinc-500 dark:focus:ring-zinc-500'

/**
 * @param {{
 *   showPostSearch?: boolean
 *   postSearchQuery?: string
 *   onPostSearchChange?: (value: string) => void
 *   onReaderWalletSynced?: (
 *     walletAddress: string,
 *     unlockedPostIds?: string[],
 *   ) => void | Promise<void>
 *   onReaderLogoutExtra?: () => void
 * }} props
 */
export default function Nav({
  showPostSearch = false,
  postSearchQuery = '',
  onPostSearchChange,
  onReaderWalletSynced,
  onReaderLogoutExtra,
}) {
  const [authorLoggedIn, setAuthorLoggedIn] = useState(false)
  const [readerWalletAddress, setReaderWalletAddress] = useState('')
  const [readerLoginBusy, setReaderLoginBusy] = useState(false)
  const [readerLoginError, setReaderLoginError] = useState('')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const mobileNavRef = useRef(null)
  const latestTxPollRef = useRef(null)
  const baselineTxidRef = useRef('')
  const lastHandledTxidRef = useRef('')
  const onReaderWalletSyncedRef = useRef(onReaderWalletSynced)
  const onReaderLogoutExtraRef = useRef(onReaderLogoutExtra)

  useEffect(() => {
    onReaderWalletSyncedRef.current = onReaderWalletSynced
    onReaderLogoutExtraRef.current = onReaderLogoutExtra
  }, [onReaderWalletSynced, onReaderLogoutExtra])

  const platformAddress = useMemo(
    () => process.env.NEXT_PUBLIC_PLATFORM_XEC_ADDRESS?.trim() ?? '',
    [],
  )
  const platformAddressForLatestTx = useMemo(
    () => platformAddress.replace(/^ecash:/, ''),
    [platformAddress],
  )

  const stopReaderTxPolling = useCallback(() => {
    if (latestTxPollRef.current) {
      clearInterval(latestTxPollRef.current)
      latestTxPollRef.current = null
    }
  }, [])

  const syncWalletToParent = useCallback((walletAddress, unlockedPostIds) => {
    void Promise.resolve(
      onReaderWalletSyncedRef.current?.(walletAddress, unlockedPostIds),
    )
  }, [])

  const persistReaderWallet = useCallback(
    (walletAddress, unlockedPostIds) => {
      const trimmed = walletAddress.trim()
      if (!trimmed) return
      try {
        localStorage.setItem('readerWalletAddress', trimmed)
      } catch {
        /* ignore */
      }
      setReaderWalletAddress(trimmed)
      syncWalletToParent(trimmed, unlockedPostIds)
    },
    [syncWalletToParent],
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
        const ids = Array.isArray(verifyData.unlockedPostIds)
          ? verifyData.unlockedPostIds
          : undefined
        persistReaderWallet(verifyData.walletAddress, ids)
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
    persistReaderWallet,
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

  const handleReaderLogout = useCallback(async () => {
    stopReaderTxPolling()
    try {
      localStorage.removeItem('readerWalletAddress')
    } catch {
      /* ignore */
    }
    setReaderWalletAddress('')
    setReaderLoginBusy(false)
    setReaderLoginError('')
    baselineTxidRef.current = ''
    lastHandledTxidRef.current = ''
    try {
      await fetch('/api/reader-logout', {
        method: 'POST',
        cache: 'no-store',
      })
    } catch {
      /* ignore */
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('readerLoggedOut'))
    }
    onReaderLogoutExtraRef.current?.()
  }, [stopReaderTxPolling])

  useEffect(() => {
    let cancelled = false

    void (async () => {
      const { data: sessionData } = await supabase.auth.getSession()
      if (!cancelled) setAuthorLoggedIn(!!sessionData.session)
    })()

    try {
      const stored = (localStorage.getItem('readerWalletAddress') || '').trim()
      if (stored) {
        // After mount only: avoids SSR/hydration mismatch vs reading localStorage in useState init.
        // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional client-only sync
        setReaderWalletAddress(stored)
        void Promise.resolve(onReaderWalletSyncedRef.current?.(stored))
      }
    } catch {
      /* ignore */
    }

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthorLoggedIn(!!session)
    })

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
      stopReaderTxPolling()
    }
  }, [stopReaderTxPolling])

  useEffect(() => {
    if (typeof window === 'undefined') return

    function onReaderLoggedIn(event) {
      const w = event.detail?.walletAddress
      const trimmed = typeof w === 'string' ? w.trim() : ''
      if (!trimmed) return
      try {
        localStorage.setItem('readerWalletAddress', trimmed)
      } catch {
        /* ignore */
      }
      setReaderWalletAddress(trimmed)
      void Promise.resolve(onReaderWalletSyncedRef.current?.(trimmed))
    }

    window.addEventListener('readerLoggedIn', onReaderLoggedIn)
    return () => {
      window.removeEventListener('readerLoggedIn', onReaderLoggedIn)
    }
  }, [])

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

  return (
    <header
      ref={mobileNavRef}
      className="sticky top-0 z-30 border-b border-zinc-200/80 bg-white/90 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/90"
    >
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-2 px-4 md:px-6">
        <Link href="/" className="min-w-0 shrink-0" aria-label="Proof of Writing home">
          <span
            style={{
              fontSize: '22px',
              fontWeight: 700,
              color: 'var(--color-text-primary)',
              letterSpacing: '-0.02em',
            }}
          >
            Proof Of Writing
          </span>
        </Link>

        <div className="hidden min-w-0 flex-1 items-center gap-3 md:flex">
          {showPostSearch && typeof onPostSearchChange === 'function' ? (
            <div className="relative min-w-0 flex-1 md:max-w-md lg:max-w-lg">
              <label htmlFor="post-search-desktop" className="sr-only">
                Search posts
              </label>
              <input
                id="post-search-desktop"
                type="search"
                value={postSearchQuery}
                onChange={(e) => onPostSearchChange(e.target.value)}
                placeholder="Search…"
                autoComplete="off"
                className={`h-8 min-h-8 ${searchInputClassName}`}
              />
              {postSearchQuery ? (
                <button
                  type="button"
                  onClick={() => onPostSearchChange('')}
                  className="absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-base leading-none text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                  aria-label="Clear search"
                >
                  ×
                </button>
              ) : null}
            </div>
          ) : (
            <div className="min-w-0 flex-1" aria-hidden />
          )}
          <Link
            href="/leaderboard"
            className="shrink-0 text-sm font-medium text-zinc-700 transition hover:text-zinc-900 hover:underline dark:text-zinc-300 dark:hover:text-zinc-100"
          >
            Leaderboard
          </Link>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <div className="flex shrink-0 items-center gap-3">
              <ThemeToggle />
              {readerWalletAddress ? (
                <div className="flex flex-nowrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium whitespace-nowrap text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full bg-emerald-500"
                    aria-hidden
                  />
                  <span
                    className="min-w-0 flex-1 truncate text-center font-mono"
                    title={readerWalletAddress}
                  >
                    {truncateAddress(readerWalletAddress)}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleReaderLogout()}
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
                <Link
                  href="/signup"
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 dark:bg-emerald-500 dark:hover:bg-emerald-400"
                >
                  Start Writing
                </Link>
              )}
            </div>
            {readerLoginError ? (
              <p className="max-w-[14rem] text-right text-xs text-red-600 dark:text-red-400">
                {readerLoginError}
              </p>
            ) : null}
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
            <span className="sr-only">
              {mobileNavOpen ? 'Close menu' : 'Open menu'}
            </span>
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
          className="mx-auto flex max-w-5xl flex-col gap-2 px-4 pt-2 pb-3"
          aria-label="Mobile navigation"
        >
          {showPostSearch && typeof onPostSearchChange === 'function' ? (
            <div className="relative w-full">
              <label htmlFor="post-search-mobile" className="sr-only">
                Search posts
              </label>
              <input
                id="post-search-mobile"
                type="search"
                value={postSearchQuery}
                onChange={(e) => onPostSearchChange(e.target.value)}
                placeholder="Search title, teaser, or author…"
                autoComplete="off"
                className={`min-h-10 ${searchInputClassName}`}
              />
              {postSearchQuery ? (
                <button
                  type="button"
                  onClick={() => onPostSearchChange('')}
                  className="absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-base leading-none text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                  aria-label="Clear search"
                >
                  ×
                </button>
              ) : null}
            </div>
          ) : null}

          {readerLoginError ? (
            <p className="text-sm text-red-600 dark:text-red-400">
              {readerLoginError}
            </p>
          ) : null}

          {readerWalletAddress ? (
            <button
              type="button"
              onClick={() => {
                void handleReaderLogout()
                closeMobileNav()
              }}
              title={readerWalletAddress}
              className="flex w-full flex-nowrap items-center justify-between gap-2 whitespace-nowrap rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-left text-xs font-medium text-emerald-800 transition hover:bg-emerald-100 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200 dark:hover:bg-emerald-900/50"
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full bg-emerald-500"
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate text-center font-mono">
                {truncateAddress(readerWalletAddress)}
              </span>
              <span className="shrink-0 text-zinc-700 dark:text-emerald-100">
                Logout
              </span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                handleReaderLogin()
                closeMobileNav()
              }}
              disabled={readerLoginBusy}
              className="w-full rounded-lg border border-emerald-300 bg-emerald-50 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200 dark:hover:bg-emerald-950"
            >
              {readerLoginBusy ? 'Waiting for payment...' : 'Reader Login'}
            </button>
          )}

          {authorLoggedIn ? (
            <Link
              href="/dashboard"
              onClick={closeMobileNav}
              className="block rounded-lg bg-zinc-900 py-2 text-center text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
            >
              Dashboard
            </Link>
          ) : (
            <Link
              href="/signup"
              onClick={closeMobileNav}
              className="block rounded-lg bg-emerald-600 py-2 text-center text-sm font-semibold text-white transition hover:bg-emerald-500 dark:bg-emerald-500 dark:hover:bg-emerald-400"
            >
              Start Writing
            </Link>
          )}

          <Link
            href="/leaderboard"
            onClick={closeMobileNav}
            className="block w-full rounded-lg border border-zinc-300 bg-white py-2 text-center text-sm font-medium text-zinc-800 transition hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Leaderboard
          </Link>
        </nav>
      </div>
    </header>
  )
}
