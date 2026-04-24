'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import FilterDropdown from '@/components/FilterDropdown'
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

const HOME_SORT_OPTIONS = [
  { value: 'earned', label: 'Most earned' },
  { value: 'unlocks', label: 'Most unlocked' },
  { value: 'newest', label: 'Newest' },
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
const MENU_AUDIENCE = 'home-audience'
const SORT_PILL_MIN_WIDTH = '15ch'
const TIME_PILL_MIN_WIDTH = '10ch'
const AUDIENCE_PILL_MIN_WIDTH = '11ch'

/** Same font family as the PROOF of WRITING wordmark in `components/Nav.js` */
const WORDMARK_FONT_FAMILY = "'American Typewriter', serif"

const heroHeadlineWordmarkStyle = {
  fontFamily: WORDMARK_FONT_FAMILY,
  letterSpacing: '-0.01em',
  lineHeight: 1.1,
  fontWeight: 500,
}

export default function HomePage() {
  const [posts, setPosts] = useState([])
  const [sortMode, setSortMode] = useState('earned')
  const [timeFilter, setTimeFilter] = useState('7d')
  const [currentPage, setCurrentPage] = useState(1)
  const [hasNextPage, setHasNextPage] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [readerWalletAddress, setReaderWalletAddress] = useState('')
  const [postSearchQuery, setPostSearchQuery] = useState('')
  const [followingOnly, setFollowingOnly] = useState(false)
  const [refetchTrigger, setRefetchTrigger] = useState(0)
  const [openMenu, setOpenMenu] = useState(/** @type {string | null} */ (null))
  const [authorLoggedIn, setAuthorLoggedIn] = useState(false)

  const trimmedPostSearch = postSearchQuery.trim()
  const displayPosts = useMemo(() => {
    if (!trimmedPostSearch) return posts
    const q = trimmedPostSearch.toLowerCase()
    return posts.filter((post) => {
      const title = String(post.title ?? '').toLowerCase()
      const teaser = String(post.teaser ?? '').toLowerCase()
      const author = authorFromPost(post)
      const username = String(author?.username ?? '').toLowerCase()
      return title.includes(q) || teaser.includes(q) || username.includes(q)
    })
  }, [posts, trimmedPostSearch])

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

  // Reset to page 1 when filters / search change
  useEffect(() => {
    setCurrentPage(1)
  }, [sortMode, postSearchQuery, timeFilter, followingOnly])

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

  // Single fetch to /api/posts — all queries run server-side in parallel
  useEffect(() => {
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
          setHasNextPage(false)
        } else {
          setPosts(data.posts ?? [])
          setHasNextPage(data.hasNextPage ?? false)
        }
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setLoadError(err.message)
        setPosts([])
        setHasNextPage(false)
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [currentPage, timeFilter, sortMode, followingOnly, readerWalletAddress, refetchTrigger])

  const showPostSearch = !loading && !loadError
  const showPaginationRow = displayPosts.length > 0 && (currentPage > 1 || hasNextPage)

  const audienceOptions = useMemo(
    () => [
      { value: 'all', label: 'All' },
      {
        value: 'following',
        label: 'Following',
        disabled: !readerWalletAddress,
        disabledHint: 'Sign in to follow writers.',
      },
    ],
    [readerWalletAddress],
  )

  return (
    <div className="min-h-full flex-1 bg-zinc-50 dark:bg-zinc-950">
      <Nav
        showPostSearch={showPostSearch}
        postSearchQuery={postSearchQuery}
        onPostSearchChange={setPostSearchQuery}
        onReaderWalletSynced={applyReaderWallet}
        onReaderLogoutExtra={handleReaderLogoutExtra}
      />

      <main className="mx-auto max-w-5xl px-4 pt-6 pb-6 sm:px-6 sm:pb-6">
        <section className="mb-6 mx-auto w-full text-center" aria-labelledby="home-hero-heading">
          <h1
            id="home-hero-heading"
            className="mx-auto max-w-none text-[clamp(1.625rem,8vw,2.25rem)] text-zinc-900 sm:text-[clamp(2rem,5vw,3.25rem)] dark:text-zinc-50"
            style={heroHeadlineWordmarkStyle}
          >
            <span className="whitespace-nowrap">Write to earn. Use eCash</span>
            <br />
            to unlock your story.
          </h1>
          <div className="mt-6 flex flex-wrap justify-center gap-2.5">
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
            <div className="mb-3">
              <div className="grid grid-cols-3 gap-1.5 sm:hidden">
                <FilterDropdown
                  menuId={MENU_SORT}
                  openMenu={openMenu}
                  setOpenMenu={setOpenMenu}
                  value={sortMode}
                  options={HOME_SORT_OPTIONS}
                  ariaLabel="Sort posts"
                  onChange={(v) => setSortMode(v)}
                  minWidth={SORT_PILL_MIN_WIDTH}
                  fullWidth
                />
                <FilterDropdown
                  menuId={MENU_TIME}
                  openMenu={openMenu}
                  setOpenMenu={setOpenMenu}
                  value={timeFilter}
                  options={HOME_TIME_OPTIONS}
                  ariaLabel="Time range for unlocks and earnings"
                  disabled={sortMode === 'newest'}
                  disabledHint="Time range does not apply when sorting by Newest."
                  onChange={(v) => setTimeFilter(v)}
                  minWidth={TIME_PILL_MIN_WIDTH}
                  fullWidth
                />
                <FilterDropdown
                  menuId={MENU_AUDIENCE}
                  openMenu={openMenu}
                  setOpenMenu={setOpenMenu}
                  value={followingOnly ? 'following' : 'all'}
                  options={audienceOptions}
                  ariaLabel="Audience"
                  onChange={(v) => setFollowingOnly(v === 'following')}
                  minWidth={AUDIENCE_PILL_MIN_WIDTH}
                  fullWidth
                />
              </div>
              <div className="hidden items-center justify-between gap-4 sm:flex">
                <h2 className="font-article-title text-lg font-semibold tracking-tight text-zinc-900 sm:text-3xl dark:text-zinc-50">
                  Latest stories...
                </h2>
                <div className="flex shrink-0 items-center gap-1.5">
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
                  <FilterDropdown
                    menuId={MENU_TIME}
                    openMenu={openMenu}
                    setOpenMenu={setOpenMenu}
                    value={timeFilter}
                    options={HOME_TIME_OPTIONS}
                    ariaLabel="Time range for unlocks and earnings"
                    disabled={sortMode === 'newest'}
                    disabledHint="Time range does not apply when sorting by Newest."
                    onChange={(v) => setTimeFilter(v)}
                    minWidth={TIME_PILL_MIN_WIDTH}
                  />
                  <FilterDropdown
                    menuId={MENU_AUDIENCE}
                    openMenu={openMenu}
                    setOpenMenu={setOpenMenu}
                    value={followingOnly ? 'following' : 'all'}
                    options={audienceOptions}
                    ariaLabel="Audience"
                    onChange={(v) => setFollowingOnly(v === 'following')}
                    minWidth={AUDIENCE_PILL_MIN_WIDTH}
                  />
                </div>
              </div>
            </div>

            {loading ? (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">Loading posts…</p>
            ) : posts.length === 0 && !readerWalletAddress ? (
              <div className="rounded-2xl border border-dashed border-zinc-300 bg-white/60 px-8 py-16 text-center dark:border-zinc-700 dark:bg-zinc-900/40">
                <p className="text-lg text-zinc-700 dark:text-zinc-300">
                  {trimmedPostSearch
                    ? `No posts found for '${trimmedPostSearch}'`
                    : 'No posts yet. Be the first to write something.'}
                </p>
              </div>
            ) : (
              <>
                {displayPosts.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-zinc-300 bg-white/60 px-8 py-12 text-center dark:border-zinc-700 dark:bg-zinc-900/40">
                    <p className="text-sm text-zinc-700 dark:text-zinc-300">
                      {trimmedPostSearch
                        ? `No posts found for '${trimmedPostSearch}'`
                        : 'No posts yet.'}
                    </p>
                  </div>
                ) : null}
                {displayPosts.length > 0 ? (
                  <ul className="flex flex-col gap-1.5 md:gap-2">
                    {displayPosts.map((post) => {
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
                        <li key={post.id}>
                          <div className="relative block cursor-pointer overflow-hidden rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm transition-[box-shadow,border-color] duration-200 hover:border-zinc-400 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-500 dark:hover:shadow-lg/20">
                            <h3 className="font-article-title text-xl font-semibold leading-snug text-zinc-900 dark:text-zinc-50">
                              <Link
                                prefetch={false}
                                href={postHref}
                                className="rounded-sm text-inherit after:absolute after:inset-0 after:content-[''] focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-950"
                              >
                                {post.title}
                              </Link>
                            </h3>
                            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-zinc-500 dark:text-zinc-400">
                              <Link href={`/u/${encodeURIComponent(username)}`} className="relative z-10 font-medium text-emerald-700 hover:text-emerald-800 underline-offset-2 hover:underline dark:text-emerald-400 dark:hover:text-emerald-300">@{username}</Link>
                              <span aria-hidden className="text-zinc-300 dark:text-zinc-600">·</span>
                              <time dateTime={(post.published_at ?? post.created_at) ?? undefined}>
                                {formatPublishedDate(post.published_at ?? post.created_at)}
                              </time>
                            </p>
                            <p className="mt-4 break-words line-clamp-4 overflow-hidden text-base leading-relaxed text-zinc-600 dark:text-zinc-400">
                              {truncateTeaserPreview(post.teaser)}
                            </p>
                            <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                              <span>{priceLabel} XEC</span>
                              {earningsStat ? (
                                <span className="font-normal text-zinc-600 dark:text-zinc-400">
                                  {earningsStat}
                                </span>
                              ) : null}
                              <span className="font-normal text-zinc-600 dark:text-zinc-400">{unlockStat}</span>
                              <span className="font-normal text-zinc-600 dark:text-zinc-400">{commentStat}</span>
                              {readTime ? <span className="font-normal text-zinc-600 dark:text-zinc-400">{readTime}</span> : null}
                            </p>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                ) : null}
              </>
            )}
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
