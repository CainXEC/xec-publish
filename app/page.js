'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
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
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
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
  'rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-500 dark:bg-emerald-500 dark:text-emerald-950 dark:hover:bg-emerald-400'
const sortBtnInactive =
  'rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900'

export default function HomePage() {
  const [fetchedPosts, setFetchedPosts] = useState([])
  const [sortMode, setSortMode] = useState('unlocks')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [loggedIn, setLoggedIn] = useState(false)

  const posts = useMemo(() => {
    if (sortMode === 'newest') return sortPostsByNewest(fetchedPosts)
    return sortPostsByUnlocksThenNewest(fetchedPosts)
  }, [fetchedPosts, sortMode])

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setLoadError(null)

      const { data: sessionData } = await supabase.auth.getSession()
      if (!cancelled) setLoggedIn(!!sessionData.session)

      const { data, error } = await supabase
        .from('posts')
        .select('*, authors(username), unlocks(count)')
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

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setLoggedIn(!!session)
    })

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [])

  return (
    <div className="min-h-full flex-1 bg-zinc-50 dark:bg-zinc-950">
      <header className="sticky top-0 z-10 border-b border-zinc-200/80 bg-white/90 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/90">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
          <Link
            href="/"
            className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
          >
            XEC Publish
          </Link>
          {loggedIn ? (
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
            <div className="mb-6 flex flex-wrap gap-2" role="group" aria-label="Sort posts">
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
            <ul className="flex flex-col gap-6">
            {posts.map((post) => {
              const author = authorFromPost(post)
              const username = author?.username?.trim() || 'Unknown'
              const authorHref =
                username !== 'Unknown' ? `/u/${encodeURIComponent(username)}` : '#'
              const postHref = `/posts/${encodeURIComponent(post.slug)}`
              const priceLabel = formatXec(post.price_xec)
              const unlocksN = unlockCountFromPost(post)
              const unlockStat =
                unlocksN === 1 ? '🔓 1 unlock' : `🔓 ${unlocksN} unlocks`

              return (
                <li key={post.id}>
                  <article className="group rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm transition hover:border-zinc-300 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 flex-1">
                        <h2 className="text-xl font-semibold leading-snug text-zinc-900 dark:text-zinc-50">
                          <Link
                            href={postHref}
                            className="transition hover:text-emerald-700 dark:hover:text-emerald-400"
                          >
                            {post.title}
                          </Link>
                        </h2>
                        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-zinc-500 dark:text-zinc-400">
                          {username !== 'Unknown' ? (
                            <Link
                              href={authorHref}
                              className="font-medium text-zinc-700 underline-offset-2 hover:text-zinc-900 hover:underline dark:text-zinc-300 dark:hover:text-zinc-100"
                            >
                              {username}
                            </Link>
                          ) : (
                            <span className="font-medium text-zinc-700 dark:text-zinc-300">
                              {username}
                            </span>
                          )}
                          <span aria-hidden className="text-zinc-300 dark:text-zinc-600">
                            ·
                          </span>
                          <time dateTime={post.created_at ?? undefined}>
                            {formatPublishedDate(post.created_at)}
                          </time>
                        </p>
                        <p className="mt-4 line-clamp-3 text-base leading-relaxed text-zinc-600 dark:text-zinc-400">
                          {post.teaser}
                        </p>
                        <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                          <span>{priceLabel} XEC</span>
                          <span className="font-normal text-zinc-600 dark:text-zinc-400">
                            {unlockStat}
                          </span>
                        </p>
                      </div>
                      <div className="flex shrink-0 sm:pt-1">
                        <Link
                          href={postHref}
                          className="inline-flex w-full items-center justify-center rounded-xl bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white transition group-hover:bg-zinc-800 sm:w-auto dark:bg-zinc-100 dark:text-zinc-900 dark:group-hover:bg-white"
                        >
                          Read Article
                        </Link>
                      </div>
                    </div>
                  </article>
                </li>
              )
            })}
            </ul>
          </>
        )}
      </main>
    </div>
  )
}
