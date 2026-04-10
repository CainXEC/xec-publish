'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Nav from '@/components/Nav'
import { supabase } from '@/lib/supabase-browser'

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
  const [readerWalletAddress, setReaderWalletAddress] = useState('')
  const [readerUnlockedPostIds, setReaderUnlockedPostIds] = useState([])
  const [readerFilterMode, setReaderFilterMode] = useState('all')
  const [postSearchQuery, setPostSearchQuery] = useState('')
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

  const handleReaderLogoutExtra = useCallback(() => {
    setReaderWalletAddress('')
    setReaderUnlockedPostIds([])
    setReaderFilterMode('all')
  }, [])

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setLoadError(null)

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

    return () => {
      cancelled = true
    }
  }, [])

  const showPostSearch = !loading && !loadError && fetchedPosts.length > 0

  return (
    <div className="min-h-full flex-1 bg-zinc-50 dark:bg-zinc-950">
      <Nav
        showPostSearch={showPostSearch}
        postSearchQuery={postSearchQuery}
        onPostSearchChange={setPostSearchQuery}
        onReaderWalletSynced={applyReaderWallet}
        onReaderLogoutExtra={handleReaderLogoutExtra}
      />

      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="mb-10 max-w-2xl">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-4xl">
            Latest articles
          </h1>
          <p className="mt-3 text-base leading-relaxed text-zinc-600 dark:text-zinc-400">
            Independent writers for independent thinkers. Pay with XEC to unlock the full story.
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
