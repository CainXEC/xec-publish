'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import FilterDropdown from '@/components/FilterDropdown'
import HeroHeadline from '@/components/HeroHeadline'
import Nav from '@/components/Nav'
import { formatReadingTimeLabel } from '@/lib/getReadingTime'
import { supabase } from '@/lib/supabase-browser'

const PAGE_SIZE = 25

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

function formatShortDate(dateStr) {
  if (!dateStr) return ''
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(
    new Date(dateStr),
  )
}

function authorFromPost(post) {
  const a = post.authors
  if (!a) return null
  return Array.isArray(a) ? a[0] ?? null : a
}

const TEASER_CARD_MAX = 500
function truncateTeaserPreview(text, maxLen = TEASER_CARD_MAX) {
  const s = text != null ? String(text) : ''
  if (s.length <= maxLen) return s
  return `${s.slice(0, maxLen)}...`
}

function HomePostCard({ post, sortMode, pinnedBadge = false }) {
  const author = authorFromPost(post)
  const username = author?.username?.trim() || 'Unknown'
  const postHref = `/posts/${encodeURIComponent(post.slug)}`
  const priceLabel = formatXec(post.price_xec)
  const unlocksN = post.unlockCount ?? 0
  const commentsN = post.commentCount ?? 0
  const unlockStat = unlocksN === 1 ? '🔓 1 unlock' : `🔓 ${unlocksN} unlocks`
  const commentStat = commentsN === 1 ? '💬 1 comment' : `💬 ${commentsN} comments`
  const readTime = formatReadingTimeLabel(post.reading_time_minutes)
  const earningsSats = Number(post.earnings)
  const earningsStat =
    sortMode === 'earned' && Number.isFinite(earningsSats)
      ? `💰 ${Math.round(earningsSats / 100).toLocaleString('en-US')} XEC earned`
      : null

  return (
    <div
      role="listitem"
      className={
        pinnedBadge
          ? 'relative block cursor-pointer overflow-hidden rounded-2xl border border-amber-300/80 bg-amber-50/40 p-6 shadow-sm transition-[box-shadow,border-color] duration-200 hover:border-amber-400 hover:shadow-md dark:border-amber-700/50 dark:bg-amber-950/25 dark:hover:border-amber-600 dark:hover:shadow-lg/20'
          : 'relative block cursor-pointer overflow-hidden rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm transition-[box-shadow,border-color] duration-200 hover:border-zinc-400 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-500 dark:hover:shadow-lg/20'
      }
    >
      {pinnedBadge ? (
        <p className="mb-2 text-xs font-semibold tracking-wide text-amber-900 dark:text-amber-200">📌 Pinned</p>
      ) : null}
      <h3 className="font-article-title text-xl font-semibold leading-snug text-zinc-900 dark:text-zinc-50">
        <Link
          prefetch={false}
          href={postHref}
          className="rounded-sm text-inherit after:absolute after:inset-0 after:content-[''] focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-950"
        >
          {post.title}
        </Link>
        {post.audio_url ? (
          <span className="relative z-10 ml-2 text-sm" title="Audio narration available" aria-label="Audio narration available">
            🎧
          </span>
        ) : null}
      </h3>
      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-zinc-500 dark:text-zinc-400">
        <Link href={`/u/${encodeURIComponent(username)}`} className="relative z-10 font-medium text-emerald-700 hover:text-emerald-800 underline-offset-2 hover:underline dark:text-emerald-400 dark:hover:text-emerald-300">
          @{username}
        </Link>
        <span aria-hidden className="text-zinc-300 dark:text-zinc-600">
          ·
        </span>
        <time dateTime={(post.published_at ?? post.created_at) ?? undefined}>{formatPublishedDate(post.published_at ?? post.created_at)}</time>
      </p>
      <p className="mt-4 break-words line-clamp-4 overflow-hidden text-base leading-relaxed text-zinc-600 dark:text-zinc-400">{truncateTeaserPreview(post.teaser)}</p>
      <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-medium text-zinc-800 dark:text-zinc-200">
        <span>{priceLabel} XEC</span>
        {earningsStat ? <span className="font-normal text-zinc-600 dark:text-zinc-400">{earningsStat}</span> : null}
        <span className="font-normal text-zinc-600 dark:text-zinc-400">{unlockStat}</span>
        <span className="font-normal text-zinc-600 dark:text-zinc-400">{commentStat}</span>
        {readTime ? <span className="font-normal text-zinc-600 dark:text-zinc-400">{readTime}</span> : null}
      </p>
    </div>
  )
}

const HOME_SORT_OPTIONS = [
  { value: 'earned', label: 'Most earned' },
  { value: 'unlocks', label: 'Most unlocked' },
  { value: 'newest', label: 'Newest' },
]

const HOME_SORT_OPTIONS_MOBILE = [
  { value: 'earned', label: '📈' },
  { value: 'unlocks', label: '🔓' },
  { value: 'newest', label: '🕐' },
]

const HOME_TIME_OPTIONS = [
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: '1y', label: '1y' },
  { value: 'all', label: 'All time' },
]

const MENU_SORT = 'home-sort'
const MENU_TIME = 'home-time'
const SORT_PILL_MIN_WIDTH = '15ch'
const TIME_PILL_MIN_WIDTH = '10ch'

const heroHeadlineWordmarkStyle = {
  fontFamily: "'American Typewriter', 'Courier New', serif",
  fontSize: 'clamp(2.25rem, 8.5vw, 5rem)',
  lineHeight: 1.05,
  letterSpacing: '-0.01em',
  fontWeight: 500,
}

export default function HomeClient({
  initialPosts,
  initialPinnedPost = null,
  initialHasNextPage,
  initialSort,
  initialTimeFilter,
  initialPage,
  initialLoadError = null,
}) {
  const [posts, setPosts] = useState(initialPosts ?? [])
  const [pinnedPost, setPinnedPost] = useState(initialPinnedPost ?? null)
  const [sortMode, setSortMode] = useState(initialSort ?? 'earned')
  const [timeFilter, setTimeFilter] = useState(initialTimeFilter ?? '24h')
  const [currentPage, setCurrentPage] = useState(initialPage ?? 1)
  const [hasNextPage, setHasNextPage] = useState(Boolean(initialHasNextPage))
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(initialLoadError)
  const [readerWalletAddress, setReaderWalletAddress] = useState('')
  const [followingOnly, setFollowingOnly] = useState(false)
  const [refetchTrigger, setRefetchTrigger] = useState(0)
  const [openMenu, setOpenMenu] = useState(/** @type {string | null} */ (null))
  const [authorLoggedIn, setAuthorLoggedIn] = useState(false)
  const didSkipInitialFetchRef = useRef(false)

  const applyReaderWallet = useCallback(async (walletAddress) => {
    setReaderWalletAddress(walletAddress)
    localStorage.setItem('readerWalletAddress', walletAddress)
  }, [])

  const handleReaderLogoutExtra = useCallback(() => {
    setReaderWalletAddress('')
    setFollowingOnly(false)
  }, [])

  useEffect(() => {
    if (!readerWalletAddress) setFollowingOnly(false)
  }, [readerWalletAddress])

  useEffect(() => {
    let cancelled = false
    void supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setAuthorLoggedIn(!!data.session)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthorLoggedIn(!!session)
    })
    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    setCurrentPage(1)
  }, [sortMode, timeFilter, followingOnly])

  useEffect(() => {
    setOpenMenu(null)
  }, [sortMode])

  useEffect(() => {
    setOpenMenu(null)
  }, [readerWalletAddress])

  useEffect(() => {
    if (!followingOnly) return
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        setCurrentPage(1)
        setRefetchTrigger((n) => n + 1)
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [followingOnly])

  useEffect(() => {
    if (!didSkipInitialFetchRef.current) {
      didSkipInitialFetchRef.current = true
      return
    }

    let cancelled = false
    setLoading(true)
    setLoadError(null)

    const params = new URLSearchParams({
      sort: sortMode,
      page: String(currentPage),
    })
    if (sortMode === 'earned' || sortMode === 'unlocks') {
      params.set('timeFilter', timeFilter)
    }

    if (followingOnly && readerWalletAddress) {
      params.set('followingOnly', 'true')
      params.set('walletAddress', readerWalletAddress)
    }

    fetch(`/api/posts?${params}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return
        if (data.error) {
          setLoadError(data.error)
          setPosts([])
          setPinnedPost(null)
          setHasNextPage(false)
        } else {
          setPosts(data.posts ?? [])
          setPinnedPost(currentPage === 1 ? data.pinnedPost ?? null : null)
          setHasNextPage(data.hasNextPage ?? false)
        }
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setLoadError(err.message)
        setPosts([])
        setPinnedPost(null)
        setHasNextPage(false)
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [currentPage, timeFilter, sortMode, followingOnly, readerWalletAddress, refetchTrigger])

  const showPinnedCard = currentPage === 1 && Boolean(pinnedPost)
  const showPostSearch = !loading && !loadError
  const showPaginationRow =
    (posts.length > 0 || showPinnedCard) && (currentPage > 1 || hasNextPage)

  const displayPosts = showPinnedCard
    ? [{ ...pinnedPost, pinned: true }, ...posts]
    : posts

  return (
    <div className="min-h-full flex-1 bg-zinc-50 dark:bg-zinc-950">
      <Nav
        showPostSearch={showPostSearch}
        onReaderWalletSynced={applyReaderWallet}
        onReaderLogoutExtra={handleReaderLogoutExtra}
      />

      <main className="mx-auto max-w-5xl px-4 pt-8 pb-10 sm:px-6 sm:pt-12">
        <section className="mb-0 mx-auto w-full text-left" aria-labelledby="home-hero-heading">
          <HeroHeadline wordmarkStyle={heroHeadlineWordmarkStyle} align="left" />
          <div className="mt-6 flex flex-wrap justify-start gap-2.5">
            <Link
              href={authorLoggedIn ? '/dashboard' : '/login'}
              className="inline-flex items-center justify-center rounded-md bg-black px-[18px] py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              {authorLoggedIn ? 'Dashboard' : 'Start writing'}
            </Link>
            <Link
              href="/how-it-works"
              className="inline-flex items-center justify-center rounded-md border border-zinc-300 bg-transparent px-[18px] py-2.5 text-sm font-medium text-zinc-700 transition hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:border-zinc-500 dark:hover:bg-zinc-900"
            >
              How it works
            </Link>
          </div>
        </section>

        {loadError ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-6 dark:border-red-900/50 dark:bg-red-950/40">
            <p className="text-sm text-red-800 dark:text-red-200">{loadError}</p>
          </div>
        ) : (
          <>
            <div className="mt-8 sm:mt-10">
              <div className="mt-4 flex items-center justify-between gap-2">
                <div className="flex shrink-0 items-baseline gap-3 sm:gap-6">
                  <button
                    type="button"
                    onClick={() => setFollowingOnly(false)}
                    className={`font-article-title text-base sm:text-2xl transition-colors ${
                      !followingOnly
                        ? 'font-medium text-zinc-900 dark:text-zinc-100'
                        : 'font-normal text-zinc-400 dark:text-zinc-600'
                    }`}
                  >
                    All stories
                  </button>
                  <button
                    type="button"
                    onClick={() => setFollowingOnly(true)}
                    className={`font-article-title text-base sm:text-2xl transition-colors ${
                      followingOnly
                        ? 'font-medium text-zinc-900 dark:text-zinc-100'
                        : 'font-normal text-zinc-400 dark:text-zinc-600'
                    }`}
                  >
                    Following
                  </button>
                </div>
                <div className="flex shrink-0 items-center gap-1 pb-1 sm:gap-1.5">
                  <div className="sm:hidden">
                    <FilterDropdown
                      menuId={MENU_SORT}
                      openMenu={openMenu}
                      setOpenMenu={setOpenMenu}
                      value={sortMode}
                      options={HOME_SORT_OPTIONS_MOBILE}
                      ariaLabel="Sort"
                      onChange={(v) => setSortMode(v)}
                    />
                  </div>
                  <div className="hidden sm:block">
                    <FilterDropdown
                      menuId={MENU_SORT}
                      openMenu={openMenu}
                      setOpenMenu={setOpenMenu}
                      value={sortMode}
                      options={HOME_SORT_OPTIONS}
                      ariaLabel="Sort posts"
                      onChange={(v) => setSortMode(v)}
                      minWidth={SORT_PILL_MIN_WIDTH}
                    />
                  </div>
                  <FilterDropdown menuId={MENU_TIME} openMenu={openMenu} setOpenMenu={setOpenMenu} value={timeFilter} options={HOME_TIME_OPTIONS} ariaLabel="Time range for unlocks and earnings" disabled={sortMode === 'newest'} disabledHint="Time range does not apply when sorting by Newest." onChange={(v) => setTimeFilter(v)} minWidth={TIME_PILL_MIN_WIDTH} />
                </div>
              </div>
            </div>

            {loading ? <p className="text-sm text-zinc-600 dark:text-zinc-400">Loading posts…</p> : null}
            {!loading && followingOnly && displayPosts.length === 0 ? (
              <div className="py-16 text-center text-sm text-zinc-500 dark:text-zinc-500">
                {readerWalletAddress
                  ? 'No posts from authors you follow yet. Explore all stories and follow some writers.'
                  : 'Log in as a reader to see posts from authors you follow.'}
              </div>
            ) : null}
            {!loading && !followingOnly && displayPosts.length === 0 && !readerWalletAddress ? (
              <div className="rounded-2xl border border-dashed border-zinc-300 bg-white/60 px-8 py-16 text-center dark:border-zinc-700 dark:bg-zinc-900/40">
                <p className="text-lg text-zinc-700 dark:text-zinc-300">No posts yet. Be the first to write something.</p>
              </div>
            ) : null}
            {displayPosts.length > 0 ? (
              <div role="list" className="mt-4 border-t border-zinc-200 dark:border-zinc-800">
                {displayPosts.map((post) => {
                  const author = authorFromPost(post)
                  const authorUsername = author?.username?.trim()
                  const authorProfileHref = authorUsername
                    ? `/u/${encodeURIComponent(authorUsername)}`
                    : '#'
                  const isLegacy = Boolean(post.legacy)
                  const slug = isLegacy
                    ? `/${encodeURIComponent(post.slug)}`
                    : `/posts/${encodeURIComponent(post.slug)}`
                  const isPinned = Boolean(post.pinned)

                  return (
                    <article
                      key={post.id}
                      className="grid grid-cols-[40px_1fr_auto] items-baseline gap-3 border-b border-zinc-100 py-4 sm:grid-cols-[68px_1fr_auto] sm:gap-6 sm:py-5 dark:border-zinc-900"
                    >
                      <time className="pt-0.5 text-xs tabular-nums text-zinc-400 dark:text-zinc-600">
                        {formatShortDate(post.published_at ?? post.created_at)}
                        {isPinned ? (
                          <span className="mt-0.5 block text-[10px] text-amber-600 dark:text-amber-400">
                            📌
                          </span>
                        ) : null}
                      </time>

                      <div className="min-w-0">
                        <h3 className="mb-1.5 font-article-title text-lg font-medium leading-snug text-zinc-900 sm:text-xl dark:text-zinc-100">
                          <Link href={slug} className="transition-opacity hover:opacity-70">
                            {post.title}
                            {post.audio_url ? (
                              <span className="ml-1.5 text-sm" aria-label="Audio narration available" title="Audio narration available">
                                🎧
                              </span>
                            ) : null}
                          </Link>
                        </h3>
                        <div className="flex flex-wrap items-center gap-x-1.5 text-sm text-zinc-500 dark:text-zinc-500">
                          <Link
                            href={authorProfileHref}
                            className="transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
                          >
                            @{author?.username}
                          </Link>
                          {post.reading_time_minutes ? (
                            <>
                              <span aria-hidden>·</span>
                              <span>{post.reading_time_minutes} min</span>
                            </>
                          ) : null}
                        </div>
                      </div>

                      <div className="whitespace-nowrap pt-0.5 font-article-title text-sm font-medium tabular-nums text-emerald-700 sm:text-lg dark:text-emerald-500">
                        <span className="hidden sm:inline">
                          {Number(post.price_xec).toLocaleString()} XEC
                        </span>
                        <span className="sm:hidden">
                          {Number(post.price_xec).toLocaleString()}
                        </span>
                      </div>
                    </article>
                  )
                })}
              </div>
            ) : null}
          </>
        )}
        {showPaginationRow ? (
          <nav aria-label="Pagination" className="mt-1.5 flex items-center justify-between gap-3 text-xs text-zinc-500 md:mt-2 dark:text-zinc-500">
            <div className="min-w-0 flex-1">
              {currentPage > 1 ? (
                <button type="button" onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} className="cursor-pointer p-0 text-left font-normal text-inherit underline-offset-2 transition hover:text-zinc-700 hover:underline focus:outline-none focus-visible:underline dark:hover:text-zinc-300">
                  ← Page {currentPage - 1}
                </button>
              ) : null}
            </div>
            <div className="min-w-0 flex-1 text-right">
              {hasNextPage ? (
                <button type="button" onClick={() => setCurrentPage((p) => p + 1)} className="cursor-pointer p-0 text-right font-normal text-inherit underline-offset-2 transition hover:text-zinc-700 hover:underline focus:outline-none focus-visible:underline dark:hover:text-zinc-300">
                  Page {currentPage + 1} →
                </button>
              ) : null}
            </div>
          </nav>
        ) : null}
      </main>
    </div>
  )
}
