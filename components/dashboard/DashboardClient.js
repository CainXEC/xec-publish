'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import ThemeToggle from '@/components/ThemeToggle'
import { supabase } from '@/lib/supabase-browser'

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

export default function DashboardClient({ email, initialPosts, loadError }) {
  const router = useRouter()
  const [posts, setPosts] = useState(initialPosts)
  const [sortMode, setSortMode] = useState('newest')
  const [timeFilter, setTimeFilter] = useState('all')
  const [unlockCountMap, setUnlockCountMap] = useState({})
  const [deleteError, setDeleteError] = useState(null)
  const [deletingId, setDeletingId] = useState(null)

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

      const { data, error } = await supabase.rpc('get_unlock_counts', {
        post_ids: postIds,
        since,
      })

      if (cancelled) return

      if (error) {
        setUnlockCountMap({})
        return
      }

      setUnlockCountMap(countRowsByPostId(data))
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
            Author Dashboard
          </h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Welcome, {email}</p>

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
            <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
              You have not created any posts yet.
            </p>
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
                      onClick={() => setTimeFilter(opt.id)}
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
                {sortedPosts.map((post) => {
                  const n = unlockCountFromPost(post)
                  const unlockLabel = n === 1 ? '1 unlock' : `${n} unlocks`

                  return (
                    <li
                      key={post.id}
                      className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-950"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 flex-1">
                          {post.slug ? (
                            <Link
                              href={`/posts/${encodeURIComponent(post.slug)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-block text-base font-medium text-emerald-700 underline-offset-2 hover:text-emerald-600 hover:underline dark:text-emerald-400 dark:hover:text-emerald-300"
                            >
                              {post.title ?? 'Untitled post'}
                            </Link>
                          ) : (
                            <p className="text-base font-medium text-zinc-900 dark:text-zinc-50">
                              {post.title ?? 'Untitled post'}
                            </p>
                          )}
                          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                            Status: {post.published ? 'Published' : 'Draft'}
                          </p>
                          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                            Price: {post.price_xec ?? 0} XEC
                          </p>
                          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                            🔓 {unlockLabel}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center gap-2">
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
            </>
          )}
        </section>
      </main>
    </div>
  )
}
