'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Nav from '@/components/Nav'
import { formatReadingTimeLabel } from '@/lib/getReadingTime'

const PAGE_SIZE = 10

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

const sortBtnActive =
  'rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-500 md:px-4 md:py-2 md:text-sm dark:bg-emerald-500 dark:text-emerald-950 dark:hover:bg-emerald-400'
const sortBtnInactive =
  'rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-800 transition hover:bg-zinc-50 md:px-4 md:py-2 md:text-sm dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900'
const filterBtnActive =
  'rounded-lg bg-emerald-100 px-2 py-1 text-[11px] font-semibold text-emerald-800 shadow-sm transition hover:bg-emerald-200 md:px-3 md:py-1.5 md:text-xs dark:bg-emerald-900/50 dark:text-emerald-200 dark:hover:bg-emerald-900'
const filterBtnInactive =
  'rounded-lg border border-zinc-300 bg-white px-2 py-1 text-[11px] font-medium text-zinc-700 transition hover:bg-zinc-50 md:px-3 md:py-1.5 md:text-xs dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800'

const TEASER_CARD_MAX = 500
function truncateTeaserPreview(text, maxLen = TEASER_CARD_MAX) {
  const s = text != null ? String(text) : ''
  if (s.length <= maxLen) return s
  return `${s.slice(0, maxLen)}...`
}

const TIME_FILTER_OPTIONS = [
  { id: '24h', label: '24h' },
  { id: '7d', label: '7d' },
  { id: '30d', label: '30d' },
  { id: '1y', label: '1y' },
  { id: 'all', label: 'All time' },
]

const timeFilterBtnActive =
  'rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-500 md:px-3 md:py-2 md:text-sm dark:bg-emerald-500 dark:text-emerald-950 dark:hover:bg-emerald-400'
const timeFilterBtnInactive =
  'rounded-lg border border-zinc-300 bg-transparent px-2.5 py-1.5 text-xs font-medium text-zinc-800 transition hover:bg-zinc-50 md:px-3 md:py-2 md:text-sm dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-900'

export default function HomePage() {
  const [posts, setPosts] = useState([])
  const [sortMode, setSortMode] = useState('newest')
  const [timeFilter, setTimeFilter] = useState('all')
  const [currentPage, setCurrentPage] = useState(1)
  const [hasNextPage, setHasNextPage] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [readerWalletAddress, setReaderWalletAddress] = useState('')
  const [readerUnlockedPostIds, setReaderUnlockedPostIds] = useState([])
  const [readerFilterMode, setReaderFilterMode] = useState('all')
  const [postSearchQuery, setPostSearchQuery] = useState('')

  const readerFilteredPosts = useMemo(() => {
    if (!readerWalletAddress || readerFilterMode === 'all') return posts
    const unlockedSet = new Set(readerUnlockedPostIds)
    if (readerFilterMode === 'unlocked') return posts.filter((p) => unlockedSet.has(p.id))
    return posts.filter((p) => !unlockedSet.has(p.id))
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

  const fetchReaderUnlocks = useCallback(async (walletAddress) => {
    if (!walletAddress) return []
    const res = await fetch(
      `/api/reader-unlocks?walletAddress=${encodeURIComponent(walletAddress)}`,
      { cache: 'no-store' },
    )
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data?.error || 'Could not fetch reader unlocks')
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

  const handleReaderLogoutExtra = useCallback(() => {
    setReaderWalletAddress('')
    setReaderUnlockedPostIds([])
    setReaderFilterMode('all')
  }, [])

  // Reset to page 1 when filters change
  useEffect(() => { setCurrentPage(1) }, [sortMode, postSearchQuery, timeFilter])
  useEffect(() => {
    if (sortMode !== 'unlocks' && sortMode !== 'earned') setTimeFilter('all')
  }, [sortMode])

  // Single fetch to /api/posts — all queries run server-side in parallel
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(null)

    const params = new URLSearchParams({
      sort: sortMode,
      timeFilter,
      page: String(currentPage),
    })

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
  }, [currentPage, timeFilter, sortMode])

  const showPostSearch = !loading && !loadError
  const showPaginationRow = displayPosts.length > 0 && (currentPage > 1 || hasNextPage)

  return (
    <div className="min-h-full flex-1 bg-zinc-50 dark:bg-zinc-950">
      <Nav
        showPostSearch={showPostSearch}
        postSearchQuery={postSearchQuery}
        onPostSearchChange={setPostSearchQuery}
        onReaderWalletSynced={applyReaderWallet}
        onReaderLogoutExtra={handleReaderLogoutExtra}
      />

      <main className="mx-auto max-w-5xl px-4 pt-2 pb-10 sm:px-6 sm:pt-2.5 sm:pb-14">
        <div
          className="max-w-2xl md:max-w-none"
          style={{ marginBottom: 'calc(0.375rem * 1.25)' }}
        >
          <p
            className="text-base leading-relaxed text-zinc-600 dark:text-zinc-400 md:whitespace-nowrap"
            style={{ fontFamily: 'Georgia, serif' }}
          >
            Written by independent writers for independent thinkers. Pay with eCash to unlock the full story.
          </p>
        </div>

        {loading ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Loading posts…</p>
        ) : loadError ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-6 dark:border-red-900/50 dark:bg-red-950/40">
            <p className="text-sm text-red-800 dark:text-red-200">{loadError}</p>
          </div>
        ) : posts.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-300 bg-white/60 px-8 py-16 text-center dark:border-zinc-700 dark:bg-zinc-900/40">
            <p className="text-lg text-zinc-700 dark:text-zinc-300">
              {trimmedPostSearch
                ? `No posts found for '${trimmedPostSearch}'`
                : 'No posts yet. Be the first to write something.'}
            </p>
          </div>
        ) : (
          <>
            <div className="mb-2 flex flex-wrap gap-1.5 md:gap-2" role="group" aria-label="Sort posts">
              <button
                type="button"
                aria-pressed={sortMode === 'newest'}
                onClick={() => setSortMode('newest')}
                className={sortMode === 'newest' ? sortBtnActive : sortBtnInactive}
              >
                🕐 Newest First
              </button>
              <button
                type="button"
                aria-pressed={sortMode === 'earned'}
                onClick={() => setSortMode('earned')}
                className={sortMode === 'earned' ? sortBtnActive : sortBtnInactive}
              >
                💰 Most Earned
              </button>
              <button
                type="button"
                aria-pressed={sortMode === 'unlocks'}
                onClick={() => setSortMode('unlocks')}
                className={sortMode === 'unlocks' ? sortBtnActive : sortBtnInactive}
              >
                🔓 Most Unlocked
              </button>
            </div>
            {sortMode === 'unlocks' || sortMode === 'earned' ? (
              <div
                className="mb-2 flex flex-wrap items-center gap-1.5 md:gap-2"
                role="group"
                aria-label="Unlock time range"
              >
                {TIME_FILTER_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    aria-pressed={timeFilter === opt.id}
                    onClick={() => setTimeFilter(opt.id)}
                    className={timeFilter === opt.id ? timeFilterBtnActive : timeFilterBtnInactive}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            ) : null}
            {readerWalletAddress ? (
              <div className="mb-2 flex flex-wrap gap-1.5 md:gap-2" role="group" aria-label="Filter posts">
                <button type="button" aria-pressed={readerFilterMode === 'all'} onClick={() => setReaderFilterMode('all')} className={readerFilterMode === 'all' ? filterBtnActive : filterBtnInactive}>All Posts</button>
                <button type="button" aria-pressed={readerFilterMode === 'unlocked'} onClick={() => setReaderFilterMode('unlocked')} className={readerFilterMode === 'unlocked' ? filterBtnActive : filterBtnInactive}>Unlocked</button>
                <button type="button" aria-pressed={readerFilterMode === 'locked'} onClick={() => setReaderFilterMode('locked')} className={readerFilterMode === 'locked' ? filterBtnActive : filterBtnInactive}>Locked</button>
              </div>
            ) : null}
            {displayPosts.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-zinc-300 bg-white/60 px-8 py-12 text-center dark:border-zinc-700 dark:bg-zinc-900/40">
                <p className="text-sm text-zinc-700 dark:text-zinc-300">
                  {trimmedPostSearch ? `No posts found for '${trimmedPostSearch}'` : 'No posts match this filter.'}
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
                        <h2 className="text-xl font-semibold leading-snug text-zinc-900 dark:text-zinc-50">
                          <Link
                            prefetch={false}
                            href={postHref}
                            className="rounded-sm text-inherit after:absolute after:inset-0 after:content-[''] focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-950"
                          >
                            {post.title}
                          </Link>
                        </h2>
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
        <div className={`flex justify-center border-t border-zinc-200 pt-4 text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400 ${showPaginationRow ? 'mt-3' : 'mt-8'}`}>
          <div className="flex-shrink-0 whitespace-nowrap text-center">
            <Link href="/about" className="transition hover:text-zinc-700 hover:underline dark:hover:text-zinc-200">About</Link>{' '}|{' '}
            <Link href="/support" className="transition hover:text-zinc-700 hover:underline dark:hover:text-zinc-200">Support</Link>{' '}|{' '}
            <Link href="/leaderboard" className="transition hover:text-zinc-700 hover:underline dark:hover:text-zinc-200">Leaderboard</Link>{' '}|{' '}
            <Link href="/get-ecash" className="transition hover:text-zinc-700 hover:underline dark:hover:text-zinc-200">Get eCash</Link>
          </div>
        </div>
      </main>
    </div>
  )
}
