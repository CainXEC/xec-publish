'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import ThemeToggle from '@/components/ThemeToggle'
import { formatReadingTimeLabel } from '@/lib/getReadingTime'
import { supabase } from '@/lib/supabase-browser'
import { fetchAllUnlockCountRows } from '@/lib/supabaseUnlockCounts'

const PAGE_SIZE = 25

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

function formatRelativeTime(iso) {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const diffMs = Date.now() - t
  const diffSec = Math.max(1, Math.floor(diffMs / 1000))
  if (diffSec < 60) return 'just now'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return diffMin === 1 ? '1 minute ago' : `${diffMin} minutes ago`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return diffHour === 1 ? '1 hour ago' : `${diffHour} hours ago`
  const diffDay = Math.floor(diffHour / 24)
  return diffDay === 1 ? '1 day ago' : `${diffDay} days ago`
}

function DashboardPostCard({ post, deletingId, onDelete }) {
  const n = unlockCountFromPost(post)
  const unlockStat = n === 1 ? '🔓 1 unlock' : `🔓 ${n} unlocks`
  const readTime = formatReadingTimeLabel(post.reading_time_minutes)
  const priceLabel = formatXec(post.price_xec)
  const publicHref =
    post.slug && post.legacy
      ? `/${encodeURIComponent(post.slug)}`
      : post.slug
        ? `/posts/${encodeURIComponent(post.slug)}`
        : null

  return (
    <li className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-950">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {publicHref ? (
              <Link
                href={publicHref}
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
            {!post.published ? (
              <span className="inline-flex shrink-0 items-center rounded-full bg-zinc-200 px-2 py-0.5 text-[11px] font-semibold text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">
                Draft
              </span>
            ) : null}
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-medium text-zinc-800 dark:text-zinc-200">
            <span>{priceLabel} XEC</span>
            <span className="font-normal text-zinc-600 dark:text-zinc-400">{unlockStat}</span>
            {readTime ? (
              <span className="font-normal text-zinc-600 dark:text-zinc-400">{readTime}</span>
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
            onClick={() => void onDelete()}
            disabled={deletingId !== null}
            className="rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 transition hover:bg-red-100 disabled:opacity-50 dark:border-red-800 dark:bg-red-950/60 dark:text-red-300 dark:hover:bg-red-950"
          >
            {deletingId === post.id ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </li>
  )
}

export default function DashboardClient({
  email,
  username,
  bio,
  xecAddress,
  notifications,
  initialPosts,
  loadError,
  initialTotalUnlocks,
  initialTotalXecRaw,
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
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [unreadNotifications, setUnreadNotifications] = useState(notifications ?? [])
  const [legacySectionOpen, setLegacySectionOpen] = useState(false)
  const copyTimeoutRef = useRef(null)
  const markReadOnViewTimeoutRef = useRef(null)

  // Stats come from the server — no loading state needed
  const totalUnlocks = typeof initialTotalUnlocks === 'number' ? initialTotalUnlocks : 0
  const totalXecEarned = typeof initialTotalXecRaw === 'number' ? initialTotalXecRaw / 100 : 0

  useEffect(() => {
    setPosts(initialPosts)
  }, [initialPosts])

  useEffect(() => {
    setUnreadNotifications(
      (notifications ?? []).map((n) => ({ ...n, read: Boolean(n.read) })),
    )
  }, [notifications])

  const unreadNotificationCount = useMemo(
    () => unreadNotifications.filter((n) => !n.read).length,
    [unreadNotifications],
  )

  const handleMarkAllRead = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) return
      setUnreadNotifications((prev) =>
        prev.map((n) => ({ ...n, read: true })),
      )
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    if (!notificationsOpen) {
      if (markReadOnViewTimeoutRef.current) {
        clearTimeout(markReadOnViewTimeoutRef.current)
        markReadOnViewTimeoutRef.current = null
      }
      return
    }

    if (unreadNotificationCount === 0) return

    markReadOnViewTimeoutRef.current = window.setTimeout(async () => {
      markReadOnViewTimeoutRef.current = null
      await handleMarkAllRead()
    }, 2000)

    return () => {
      if (markReadOnViewTimeoutRef.current) {
        clearTimeout(markReadOnViewTimeoutRef.current)
        markReadOnViewTimeoutRef.current = null
      }
    }
  }, [handleMarkAllRead, notificationsOpen, unreadNotificationCount])

  useEffect(() => {
    if (sortMode !== 'unlocks') {
      setTimeFilter('all')
    }
  }, [sortMode])

  const nonLegacyPosts = useMemo(
    () => posts.filter((p) => p.legacy !== true),
    [posts],
  )

  const legacyPosts = useMemo(
    () => posts.filter((p) => p.legacy === true),
    [posts],
  )

  const legacyPostsSorted = useMemo(() => {
    return [...legacyPosts].sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )
  }, [legacyPosts])

  useEffect(() => {
    if (!legacySectionOpen || legacyPosts.length === 0) return

    let cancelled = false

    async function loadLegacyUnlockCounts() {
      const postIds = legacyPosts.map((p) => p.id).filter(Boolean)
      const since = getSinceTimestamp(
        sortMode === 'unlocks' ? timeFilter : 'all',
      )
      const { error, rows } = await fetchAllUnlockCountRows(
        supabase,
        postIds,
        since,
      )
      if (cancelled) return
      if (error) return
      const patch = countRowsByPostId(rows ?? [])
      setUnlockCountMap((prev) => ({ ...prev, ...patch }))
    }

    void loadLegacyUnlockCounts()
    return () => {
      cancelled = true
    }
  }, [legacySectionOpen, legacyPosts, sortMode, timeFilter])

  useEffect(() => {
    let cancelled = false

    async function loadUnlockCounts() {
      const postIds = nonLegacyPosts.map((p) => p.id).filter(Boolean)
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
  }, [nonLegacyPosts, sortMode, timeFilter])

  const sortedPosts = useMemo(() => {
    const withCounts = nonLegacyPosts.map((p) => ({
      ...p,
      unlocks: [{ count: unlockCountMap[p.id] ?? 0 }],
    }))
    if (sortMode === 'newest') return sortPostsByNewest(withCounts)
    return sortPostsByUnlocksThenNewest(withCounts)
  }, [nonLegacyPosts, unlockCountMap, sortMode])

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
      if (markReadOnViewTimeoutRef.current) {
        clearTimeout(markReadOnViewTimeoutRef.current)
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
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
              Welcome{' '}
              <Link
                href={`/u/${encodeURIComponent(username)}`}
                className="font-medium hover:underline underline-offset-2"
              >
                @{username}
              </Link>
              !
            </h1>
            <button
              type="button"
              onClick={() => setNotificationsOpen((open) => !open)}
              className="relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-zinc-300 bg-white text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
              aria-label="Toggle notifications"
              aria-expanded={notificationsOpen}
            >
              <span aria-hidden>🔔</span>
              {unreadNotificationCount > 0 ? (
                <span className="absolute -right-1 -top-1 inline-flex min-w-[1.1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
                  {unreadNotificationCount}
                </span>
              ) : null}
            </button>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
            <div className="rounded-lg border border-zinc-200 bg-zinc-50/80 p-4 dark:border-zinc-700 dark:bg-zinc-950/80">
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Total Unlocks
              </p>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                <span aria-hidden className="mr-1.5">🔓</span>
                {totalUnlocks}
              </p>
            </div>
            <div className="rounded-lg border border-zinc-200 bg-zinc-50/80 p-4 dark:border-zinc-700 dark:bg-zinc-950/80">
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Total Earned
              </p>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                <span aria-hidden className="mr-1.5">💰</span>
                {Math.round(totalXecEarned).toLocaleString('en-US')} XEC
              </p>
            </div>
          </div>
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
          {notificationsOpen ? (
            <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-950">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                  Notifications
                </p>
                {unreadNotificationCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => void handleMarkAllRead()}
                    className="text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
                  >
                    Mark all read
                  </button>
                ) : null}
              </div>
              {unreadNotifications.length === 0 ? (
                <p className="text-sm text-zinc-600 dark:text-zinc-400">No new notifications</p>
              ) : (
                <ul className="space-y-1.5">
                  {unreadNotifications.map((n) => {
                    const postRel = Array.isArray(n.posts) ? n.posts[0] : n.posts
                    const slug = postRel?.slug ?? ''
                    const isLegacy = postRel?.legacy === true
                    const href = slug
                      ? isLegacy
                        ? `/${encodeURIComponent(slug)}`
                        : `/posts/${encodeURIComponent(slug)}`
                      : '#'
                    const title = postRel?.title ?? 'Post'
                    const message = n.message || `New comment on '${title}'`
                    return (
                      <li key={n.id}>
                        <Link
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`block rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800 ${
                            n.read ? 'opacity-60' : ''
                          }`}
                        >
                          <p className="text-zinc-800 dark:text-zinc-200">{message}</p>
                          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                            {formatRelativeTime(n.created_at)}
                          </p>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              )}
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

          {nonLegacyPosts.length === 0 ? (
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
                {pagedSortedPosts.map((post) => (
                  <DashboardPostCard
                    key={post.id}
                    post={post}
                    deletingId={deletingId}
                    onDelete={() => void handleDeletePost(post.id)}
                  />
                ))}
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

        {legacyPosts.length > 0 ? (
          <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <button
              type="button"
              onClick={() => setLegacySectionOpen((open) => !open)}
              aria-expanded={legacySectionOpen}
              className="flex w-full items-center justify-between gap-3 text-left"
            >
              <h2 className="text-base font-semibold text-zinc-600 dark:text-zinc-400">
                Legacy Posts ({legacyPosts.length})
              </h2>
              <span className="shrink-0 text-zinc-500 tabular-nums dark:text-zinc-500" aria-hidden>
                {legacySectionOpen ? '▾' : '▸'}
              </span>
            </button>
            {legacySectionOpen ? (
              <ul className="mt-4 flex flex-col gap-1.5 md:gap-2">
                {legacyPostsSorted.map((post) => (
                  <DashboardPostCard
                    key={post.id}
                    post={{
                      ...post,
                      unlocks: [{ count: unlockCountMap[post.id] ?? 0 }],
                    }}
                    deletingId={deletingId}
                    onDelete={() => void handleDeletePost(post.id)}
                  />
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}
      </main>
    </div>
  )
}