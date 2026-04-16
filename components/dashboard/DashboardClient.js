'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import ThemeToggle from '@/components/ThemeToggle'
import { formatReadingTimeLabel } from '@/lib/getReadingTime'
import { supabase } from '@/lib/supabase-browser'
import { fetchAllUnlockCountRows } from '@/lib/supabaseUnlockCounts'

const PAGE_SIZE = 10

function formatXec(amount) {
  const n = Number(amount)
  if (!Number.isFinite(n)) return '0'
  return n.toFixed(8).replace(/\.?0+$/, '')
}

const DELETE_CONFIRM =
  'Are you sure you want to delete this post? This cannot be undone.'

function getSinceTimestamp(timeFilter) {
  if (timeFilter === 'all') return null
  const now = new Date()
  if (timeFilter === '24h') now.setHours(now.getHours() - 24)
  if (timeFilter === '7d') now.setDate(now.getDate() - 7)
  if (timeFilter === '30d') now.setDate(now.getDate() - 30)
  if (timeFilter === '1y') now.setFullYear(now.getFullYear() - 1)
  return now.toISOString()
}

const TIME_FILTER_OPTIONS = [
  { id: '24h', label: '24h' },
  { id: '7d', label: '7d' },
  { id: '30d', label: '30d' },
  { id: '1y', label: '1y' },
  { id: 'all', label: 'All time' },
]

const sortBtnActive =
  'rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-500 md:px-4 md:py-2 md:text-sm dark:bg-emerald-500 dark:text-emerald-950 dark:hover:bg-emerald-400'
const sortBtnInactive =
  'rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-800 transition hover:bg-zinc-50 md:px-4 md:py-2 md:text-sm dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900'

const timeFilterBtnActive =
  'rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-500 md:px-3 md:py-2 md:text-sm dark:bg-emerald-500 dark:text-emerald-950 dark:hover:bg-emerald-400'
const timeFilterBtnInactive =
  'rounded-lg border border-zinc-300 bg-transparent px-2.5 py-1.5 text-xs font-medium text-zinc-800 transition hover:bg-zinc-50 md:px-3 md:py-2 md:text-sm dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-900'

function unlockCountFromPost(post) {
  const u = post.unlocks
  if (!u) return 0
  const row = Array.isArray(u) ? u[0] : u
  const c = row?.count
  const n = typeof c === 'number' ? c : Number(c)
  return Number.isFinite(n) ? n : 0
}

function countRowsByPostId(rows) {
  const map = {}
  if (!Array.isArray(rows)) return map
  for (const r of rows) {
    const id = r.post_id
    if (id == null) continue
    const n = typeof r.count === 'number' ? r.count : Number(r.count)
    map[id] = Number.isFinite(n) ? n : 0
  }
  return map
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

export default function DashboardClient({
  email,
  username,
  bio,
  xecAddress,
  initialPosts,
  loadError,
}) {
  const router = useRouter()
  const [posts, setPosts] = useState(initialPosts)
  const [sortMode, setSortMode] = useState('newest')
  const [timeFilter, setTimeFilter] = useState('all')
  const [unlockCountMap, setUnlockCountMap] = useState({})
  const [deleteError, setDeleteError] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [copiedAddress, setCopiedAddress] = useState(false)
  const copyTimeoutRef = useRef(null)

  useEffect(() => {
    setPosts(initialPosts)
  }, [initialPosts])

  useEffect(() => {
    if (sortMode !== 'unlocks') {
      setTimeFilter('all')
    }
  }, [sortMode])

  useEffect(() => {
    let cancelled = false

    async function loadUnlockCounts() {
      const postIds = posts.map((p) => p.id).filter(Boolean)
      if (postIds.length === 0) {
        setUnlockCountMap({})
        return
      }

      const since = getSinceTimestamp(
        sortMode === 'unlocks' ? timeFilter : 'all',
      )

      const { error, rows } = await fetchAllUnlockCountRows(
        supabase,
        postIds,
        since,
      )

      if (cancelled) return

      if (error) {
        setUnlockCountMap({})
        return
      }

      setUnlockCountMap(countRowsByPostId(rows ?? []))
    }

    void loadUnlockCounts()

    return () => {
      cancelled = true
    }
  }, [posts, sortMode, timeFilter])

  const sortedPosts = useMemo(() => {
    const withCounts = posts.map((p) => ({
      ...p,
      unlocks: [{ count: unlockCountMap[p.id] ?? 0 }],
    }))
    if (sortMode === 'newest') return sortPostsByNewest(withCounts)
    return sortPostsByUnlocksThenNewest(withCounts)
  }, [posts, unlockCountMap, sortMode])

  const totalPages = Math.max(1, Math.ceil(sortedPosts.length / PAGE_SIZE))
  const effectivePage = Math.max(1, Math.min(currentPage, totalPages))

  const pagedSortedPosts = useMemo(() => {
    const start = (effectivePage - 1) * PAGE_SIZE
    return sortedPosts.slice(start, start + PAGE_SIZE)
  }, [sortedPosts, effectivePage])

  const hasPrevPage = effectivePage > 1 && sortedPosts.length > 0
  const hasNextPage = effectivePage < totalPages

  const handleDeletePost = useCallback(async (postId) => {
    if (!window.confirm(DELETE_CONFIRM)) return

    setDeleteError(null)
    setDeletingId(postId)

    try {
      const { data: userData, error: userError } = await supabase.auth.getUser()
      if (userError || !userData.user) {
        setDeleteError(userError?.message || 'You must be signed in to delete a post.')
        return
      }

      const userId = userData.user.id

      const { error: deleteErrorResult, count } = await supabase
        .from('posts')
        .delete({ count: 'exact' })
        .eq('id', postId)
        .eq('author_id', userId)

      if (deleteErrorResult) {
        setDeleteError(deleteErrorResult.message)
        return
      }

      if (typeof count === 'number' && count === 0) {
        setDeleteError('Could not delete this post. It may have already been removed.')
        return
      }

      setPosts((prev) => prev.filter((p) => p.id !== postId))
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : 'Something went wrong while deleting.',
      )
    } finally {
      setDeletingId(null)
    }
  }, [])

  const handleLogout = useCallback(async () => {
    await supabase.auth.signOut()
    router.refresh()
    router.push('/')
  }, [router])

  const handleCopyXecAddress = useCallback(async () => {
    const trimmed = typeof xecAddress === 'string' ? xecAddress.trim() : ''
    if (!trimmed) return
    try {
      await navigator.clipboard.writeText(trimmed)
      setCopiedAddress(true)
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current)
      }
      copyTimeoutRef.current = setTimeout(() => {
        setCopiedAddress(false)
      }, 2000)
    } catch {
      setCopiedAddress(false)
    }
  }, [xecAddress])

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current)
      }
    }
  }, [])

  if (loadError) {
    return (
      <div className="flex min-h-full flex-1 items-center justify-center bg-zinc-50 px-4 py-16 dark:bg-zinc-950">
        <div className="w-full max-w-xl rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>
          <Link
            href="/dashboard"
            className="mt-4 inline-block text-sm font-medium text-zinc-900 underline dark:text-zinc-200"
          >
            Try again
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-zinc-50 px-4 py-10 dark:bg-zinc-950">
      <main className="mx-auto w-full max-w-4xl">
        <div className="flex items-center justify-between gap-3">
          <Link
            href="/"
            className="text-sm font-medium text-emerald-700 underline-offset-4 hover:underline dark:text-emerald-400"
          >
            ← Home
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Logout
            </button>
          </div>
        </div>
        <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
            Welcome {username}!
          </h1>
          {bio ? (
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{bio}</p>
          ) : null}
          {xecAddress ? (
            <div className="mt-1">
              <p
                className="cursor-pointer break-all font-mono text-xs text-zinc-500 dark:text-zinc-400"
                onClick={() => void handleCopyXecAddress()}
                title="Click to copy"
              >
                {xecAddress}
              </p>
              {copiedAddress ? (
                <p className="mt-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  Copied!
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              href="/dashboard/new-post"
              className="inline-flex rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
            >
              Write New Post
            </Link>
            <Link
              href="/dashboard/profile"
              className="inline-flex rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Edit Profile
            </Link>
          </div>
        </div>

        <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Your Posts</h2>

          {deleteError ? (
            <p
              className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-200"
              role="alert"
            >
              {deleteError}
            </p>
          ) : null}

          {posts.length === 0 ? (
            <div className="mt-4">
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Welcome to Proof Of Writing! Create your first post to get started.
              </p>
              <Link
                href="/dashboard/new-post"
                className="mt-4 inline-flex rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
              >
                Create your first post
              </Link>
            </div>
          ) : (
            <>
              <div
                className="mt-4 mb-2 flex flex-wrap gap-1.5 md:gap-2"
                role="group"
                aria-label="Sort posts"
              >
                <button
                  type="button"
                  aria-pressed={sortMode === 'unlocks'}
                  onClick={() => {
                    setCurrentPage(1)
                    setSortMode('unlocks')
                  }}
                  className={sortMode === 'unlocks' ? sortBtnActive : sortBtnInactive}
                >
                  🔓 Most Unlocked
                </button>
                <button
                  type="button"
                  aria-pressed={sortMode === 'newest'}
                  onClick={() => {
                    setCurrentPage(1)
                    setSortMode('newest')
                  }}
                  className={sortMode === 'newest' ? sortBtnActive : sortBtnInactive}
                >
                  🕐 Newest First
                </button>
              </div>

              {sortMode === 'unlocks' ? (
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
                      onClick={() => {
                        setCurrentPage(1)
                        setTimeFilter(opt.id)
                      }}
                      className={
                        timeFilter === opt.id
                          ? timeFilterBtnActive
                          : timeFilterBtnInactive
                      }
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              ) : null}

              <ul className="flex flex-col gap-1.5 md:gap-2">
                {pagedSortedPosts.map((post) => {
                  const n = unlockCountFromPost(post)
                  const unlockStat =
                    n === 1 ? '🔓 1 unlock' : `🔓 ${n} unlocks`
                  const readTime = formatReadingTimeLabel(post.reading_time_minutes)
                  const priceLabel = formatXec(post.price_xec)

                  return (
                    <li
                      key={post.id}
                      className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-950"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            {post.slug ? (
                              <Link
                                href={`/posts/${encodeURIComponent(post.slug)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="min-w-0 text-base font-medium text-emerald-700 underline-offset-2 hover:text-emerald-600 hover:underline dark:text-emerald-400 dark:hover:text-emerald-300"
                              >
                                {post.title ?? 'Untitled post'}
                              </Link>
                            ) : (
                              <p className="min-w-0 text-base font-medium text-zinc-900 dark:text-zinc-50">
                                {post.title ?? 'Untitled post'}
                              </p>
                            )}
                            {post.published ? (
                              <span className="inline-flex shrink-0 items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200">
                                Published
                              </span>
                            ) : (
                              <span className="inline-flex shrink-0 items-center rounded-full bg-zinc-200 px-2 py-0.5 text-[11px] font-semibold text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">
                                Draft
                              </span>
                            )}
                          </div>
                          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                            <span>{priceLabel} XEC</span>
                            <span className="font-normal text-zinc-600 dark:text-zinc-400">
                              {unlockStat}
                            </span>
                            {readTime ? (
                              <span className="font-normal text-zinc-600 dark:text-zinc-400">
                                {readTime}
                              </span>
                            ) : null}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center gap-2">
                          {!post.published ? (
                            <Link
                              href={`/dashboard/preview/${encodeURIComponent(post.id)}`}
                              className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-900 transition hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-200 dark:hover:bg-amber-900/50"
                            >
                              Preview
                            </Link>
                          ) : null}
                          <Link
                            href={`/dashboard/edit/${encodeURIComponent(post.id)}`}
                            className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                          >
                            Edit
                          </Link>
                          <button
                            type="button"
                            onClick={() => void handleDeletePost(post.id)}
                            disabled={deletingId !== null}
                            className="rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 transition hover:bg-red-100 disabled:opacity-50 dark:border-red-800 dark:bg-red-950/60 dark:text-red-300 dark:hover:bg-red-950"
                          >
                            {deletingId === post.id ? 'Deleting…' : 'Delete'}
                          </button>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
              {sortedPosts.length > PAGE_SIZE ? (
                <div className="mt-6 flex items-center justify-between gap-2 border-t border-zinc-200 pt-4 text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                  <div className="min-w-0 flex-1">
                    {hasPrevPage ? (
                      <button
                        type="button"
                        onClick={() => setCurrentPage(effectivePage - 1)}
                        className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                      >
                        ← Page {effectivePage - 1}
                      </button>
                    ) : null}
                  </div>
                  <span className="flex-shrink-0 tabular-nums">
                    Page {effectivePage} of {totalPages}
                  </span>
                  <div className="min-w-0 flex-1 text-right">
                    {hasNextPage ? (
                      <button
                        type="button"
                        onClick={() => setCurrentPage(effectivePage + 1)}
                        className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                      >
                        Page {effectivePage + 1} →
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </>
          )}
        </section>
      </main>
    </div>
  )
}
