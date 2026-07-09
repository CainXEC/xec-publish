'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import ThemeToggle from '@/components/ThemeToggle'

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
 * One identity, read from GET /api/me (the pow_session cookie):
 *   not authenticated        -> "Log in"        (-> /login)
 *   authenticated reader      -> identity + Logout
 *   authenticated author/admin-> Dashboard + identity + Logout
 * Handles show in full; raw ecash addresses are truncated.
 *
 * @param {{
 *   authorCtaOverride?: 'logout'
 *   showPostSearch?: boolean
 * }} props
 */
export default function Nav({ authorCtaOverride, showPostSearch = false }) {
  const router = useRouter()
  const pathname = usePathname()
  // Session identity: the authed /api/me object, or null when logged out.
  const [me, setMe] = useState(null)
  const [unreadCount, setUnreadCount] = useState(0)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [desktopSearchOpen, setDesktopSearchOpen] = useState(false)
  const [searchInputValue, setSearchInputValue] = useState('')
  const mobileNavRef = useRef(null)
  const desktopSearchRef = useRef(null)
  const desktopSearchInputRef = useRef(null)

  const isAuthor = Boolean(me?.authorId)
  const identityLabel = me?.handle
    ? me.handle
    : truncateAddress(me?.address ?? '')
  // A custom handle color only applies when a handle is shown (not a raw address).
  const identityColor = me?.handle && me?.handleColor ? me.handleColor : undefined

  const refetchMe = useCallback(async () => {
    try {
      const res = await fetch('/api/me', { cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      setMe(data && data.authenticated ? data : null)
    } catch {
      setMe(null)
    }
  }, [])

  useEffect(() => {
    void refetchMe()
  }, [refetchMe])

  // Cross-component session sync: PostPageClient fires 'sessionChanged' after a
  // pay-to-unlock login; logout below fires it too. Both nav + post page react
  // by re-reading /api/me. Replaces the old readerLoggedIn/readerLoggedOut pair.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const onChange = () => void refetchMe()
    window.addEventListener('sessionChanged', onChange)
    return () => window.removeEventListener('sessionChanged', onChange)
  }, [refetchMe])

  const handleLogout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', cache: 'no-store' })
    } catch {
      /* ignore */
    }
    setMe(null)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('sessionChanged'))
    }
    router.refresh()
  }, [router])

  const handleSearchSubmit = useCallback(
    (e) => {
      e.preventDefault()
      const trimmed = String(searchInputValue ?? '').trim()
      if (!trimmed) return
      const params = new URLSearchParams({ q: trimmed })
      router.push(`/search?${params.toString()}`)
      setMobileNavOpen(false)
    },
    [searchInputValue, router],
  )

  const showDashboardButton = isAuthor && authorCtaOverride !== 'logout'

  useEffect(() => {
    if (!showDashboardButton) return

    const fetchCount = async () => {
      try {
        const res = await fetch('/api/notifications/unread-count')
        if (res.ok) {
          const { count } = await res.json()
          setUnreadCount(typeof count === 'number' && Number.isFinite(count) ? count : 0)
        }
      } catch {
        /* ignore */
      }
    }

    void fetchCount()
    const interval = setInterval(() => void fetchCount(), 60_000)
    return () => clearInterval(interval)
  }, [showDashboardButton])

  useEffect(() => {
    if (pathname === '/dashboard') {
      setUnreadCount(0)
    }
  }, [pathname])

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
    const mq = window.matchMedia('(min-width: 640px)')
    function onChange() {
      if (mq.matches) setMobileNavOpen(false)
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    if (!desktopSearchOpen) return
    desktopSearchInputRef.current?.focus()
  }, [desktopSearchOpen])

  useEffect(() => {
    if (!desktopSearchOpen) return
    function onPointerDown(e) {
      if (
        desktopSearchRef.current &&
        e.target instanceof Node &&
        !desktopSearchRef.current.contains(e.target)
      ) {
        setDesktopSearchOpen(false)
      }
    }
    function onKeyDown(e) {
      if (e.key === 'Escape') setDesktopSearchOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [desktopSearchOpen])

  const wordmarkInner = (
    <span
      style={{
        fontFamily:
          "'American Typewriter', var(--font-jetbrains-mono), 'Courier New', serif",
        color: 'var(--color-text-primary)',
        letterSpacing: '0.04em',
        lineHeight: '1',
        whiteSpace: 'nowrap',
      }}
    >
      <span
        className="hidden md:inline"
        style={{ fontSize: '38px', textTransform: 'uppercase' }}
      >
        PROOF <span style={{ textTransform: 'none' }}>of</span> WRITING
      </span>
      <span
        className="inline md:hidden"
        style={{ fontSize: '26px', textTransform: 'uppercase' }}
      >
        PROOF <span style={{ textTransform: 'none' }}>of</span> WRITING
      </span>
    </span>
  )

  const navLogo = (
    <Link
      href="/"
      className="pointer-events-auto inline-flex items-center"
      aria-label="Proof Of Writing home"
      style={{ flexShrink: 0, minWidth: 0 }}
    >
      {wordmarkInner}
    </Link>
  )

  const desktopSearch =
    showPostSearch ? (
      <div ref={desktopSearchRef} className="relative">
        <div
          className={`overflow-hidden transition-[width,opacity] duration-200 ${
            desktopSearchOpen ? 'w-64 opacity-100' : 'w-9 opacity-100'
          }`}
        >
          {desktopSearchOpen ? (
            <form className="relative" onSubmit={handleSearchSubmit}>
              <label htmlFor="post-search-desktop" className="sr-only">
                Search posts
              </label>
              <input
                ref={desktopSearchInputRef}
                id="post-search-desktop"
                type="search"
                value={searchInputValue}
                onChange={(e) => setSearchInputValue(e.target.value)}
                placeholder="Search…"
                autoComplete="off"
                className={`h-9 min-h-9 w-64 ${searchInputClassName}`}
              />
              {searchInputValue ? (
                <button
                  type="button"
                  onClick={() => setSearchInputValue('')}
                  className="absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-base leading-none text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                  aria-label="Clear search"
                >
                  ×
                </button>
              ) : null}
            </form>
          ) : (
            <button
              type="button"
              id="post-search-desktop-toggle"
              onClick={() => setDesktopSearchOpen(true)}
              className="relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-300 bg-white text-base leading-none text-zinc-700 transition hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              aria-label="Open search"
            >
              <svg
                viewBox="0 0 24 24"
                aria-hidden
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              {searchInputValue ? (
                <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-emerald-500" />
              ) : null}
            </button>
          )}
        </div>
      </div>
    ) : null

  const identityChipDesktop = me ? (
    <div className="flex h-9 flex-nowrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 text-xs font-medium whitespace-nowrap text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200">
      <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden />
      <span
        className="min-w-0 flex-1 truncate text-center font-mono"
        title={me.address}
        style={identityColor ? { color: identityColor } : undefined}
      >
        {identityLabel}
      </span>
      <button
        type="button"
        onClick={() => void handleLogout()}
        className="shrink-0 rounded px-1.5 py-0.5 text-zinc-700 transition hover:bg-emerald-100 hover:text-zinc-900 dark:text-emerald-100 dark:hover:bg-emerald-900"
      >
        Logout
      </button>
    </div>
  ) : null

  const dashboardButtonDesktop = (
    <Link
      href="/dashboard"
      className="relative inline-flex h-9 items-center justify-center rounded-md bg-black px-4 text-sm font-medium whitespace-nowrap text-white transition hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
    >
      Dashboard
      {unreadCount > 0 ? (
        <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-semibold leading-none text-white">
          {unreadCount > 9 ? '9+' : unreadCount}
        </span>
      ) : null}
    </Link>
  )

  const loginButtonDesktop = (
    <Link
      href="/login"
      className="inline-flex h-9 items-center justify-center rounded-md bg-black px-4 text-sm font-medium whitespace-nowrap text-white transition hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
    >
      Log in
    </Link>
  )

  const authClusterDesktop =
    authorCtaOverride === 'logout' ? (
      <button
        type="button"
        onClick={() => void handleLogout()}
        className="inline-flex h-9 items-center justify-center rounded-md bg-black px-4 text-sm font-medium whitespace-nowrap text-white transition hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
      >
        Log out
      </button>
    ) : me ? (
      <div className="flex items-center gap-2">
        {isAuthor ? dashboardButtonDesktop : null}
        {identityChipDesktop}
      </div>
    ) : (
      loginButtonDesktop
    )

  return (
    <header
      ref={mobileNavRef}
      className="sticky top-0 z-30 border-b-[0.5px] border-zinc-200 bg-white/90 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/90"
    >
        <div className="relative mx-auto max-w-5xl px-4 sm:px-6">
          <div className="grid min-h-14 grid-cols-[auto_1fr_auto] items-center sm:hidden">
          <button
            type="button"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-300 bg-white text-lg leading-none text-zinc-800 transition hover:bg-zinc-50 sm:hidden dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            aria-expanded={mobileNavOpen}
            aria-controls="mobile-nav-menu"
            onClick={() => setMobileNavOpen((o) => !o)}
          >
            <span aria-hidden>☰</span>
            <span className="sr-only">
              {mobileNavOpen ? 'Close menu' : 'Open menu'}
            </span>
          </button>

          <div className="min-w-0 justify-self-center sm:justify-self-auto">{navLogo}</div>

          <div className="justify-self-end sm:hidden">
            <ThemeToggle />
          </div>
          </div>

          <div className="hidden min-h-14 grid-cols-[1fr_auto_1fr] items-center gap-4 sm:grid">
            <div className="flex min-w-0 items-center justify-start gap-3">
              <div className="shrink-0">{authClusterDesktop}</div>
            </div>
            <div className="flex min-w-0 items-center justify-center">
              {navLogo}
            </div>
            <div className="flex min-w-0 items-center justify-end gap-1.5">
                {desktopSearch}
                <ThemeToggle />
            </div>
          </div>
        </div>

        <div
          id="mobile-nav-menu"
          className={`border-t border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-950 sm:hidden ${
            mobileNavOpen ? 'block' : 'hidden'
          }`}
        >
          <nav
            className="mx-auto flex max-w-5xl flex-col gap-2 px-4 pt-2 pb-3 sm:px-6"
            aria-label="Mobile navigation"
          >
            {showPostSearch ? (
              <form className="relative" onSubmit={handleSearchSubmit}>
                <label htmlFor="post-search-mobile-marketing" className="sr-only">
                  Search posts
                </label>
                <input
                  id="post-search-mobile-marketing"
                  type="search"
                  value={searchInputValue}
                  onChange={(e) => setSearchInputValue(e.target.value)}
                  placeholder="Search posts..."
                  autoComplete="off"
                  className={`h-11 w-full ${searchInputClassName}`}
                />
                {searchInputValue ? (
                  <button
                    type="button"
                    onClick={() => setSearchInputValue('')}
                    className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-base leading-none text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                    aria-label="Clear search"
                  >
                    ×
                  </button>
                ) : null}
              </form>
            ) : null}

            {authorCtaOverride === 'logout' ? (
              <button
                type="button"
                onClick={() => {
                  void handleLogout()
                  closeMobileNav()
                }}
                className="inline-flex h-11 w-full items-center justify-center rounded-md bg-black text-center text-sm font-medium text-white dark:bg-white dark:text-zinc-950"
              >
                Log out
              </button>
            ) : me ? (
              <>
                {isAuthor ? (
                  <Link
                    href="/dashboard"
                    onClick={closeMobileNav}
                    className="relative inline-flex h-11 w-full items-center justify-center rounded-md bg-black text-center text-sm font-medium text-white dark:bg-white dark:text-zinc-950"
                  >
                    Dashboard
                    {unreadCount > 0 ? (
                      <span className="absolute top-1.5 right-3 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-semibold leading-none text-white">
                        {unreadCount > 9 ? '9+' : unreadCount}
                      </span>
                    ) : null}
                  </Link>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    void handleLogout()
                    closeMobileNav()
                  }}
                  title={me.address}
                  className="flex h-11 w-full flex-nowrap items-center justify-between gap-2 whitespace-nowrap rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 text-left text-xs font-medium text-emerald-800 transition hover:bg-emerald-100 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200 dark:hover:bg-emerald-900/50"
                >
                  <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden />
                  <span
                    className="min-w-0 flex-1 truncate text-center font-mono"
                    style={identityColor ? { color: identityColor } : undefined}
                  >
                    {identityLabel}
                  </span>
                  <span className="shrink-0 text-zinc-700 dark:text-emerald-100">Logout</span>
                </button>
              </>
            ) : (
              <Link
                href="/login"
                onClick={closeMobileNav}
                className="inline-flex h-11 w-full items-center justify-center rounded-md bg-black text-center text-sm font-medium text-white dark:bg-white dark:text-zinc-950"
              >
                Log in
              </Link>
            )}
          </nav>
        </div>
      </header>
  )
}
