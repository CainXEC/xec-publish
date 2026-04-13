'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { formatReadingTimeLabel } from '@/lib/getReadingTime'
import { supabase } from '@/lib/supabase-browser'
import { fetchAllUnlockCountRows } from '@/lib/supabaseUnlockCounts'

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

function mergeUnlockAndCommentCounts(posts, unlockRows, commentRows) {
  const unlockById = countRowsByPostId(unlockRows)
  const commentById = countRowsByPostId(commentRows)
  return posts.map((p) => ({
    ...p,
    unlocks: [{ count: unlockById[p.id] ?? 0 }],
    comments: [{ count: commentById[p.id] ?? 0 }],
  }))
}

function postsHaveAllTimeCounts(posts) {
  if (!Array.isArray(posts) || posts.length === 0) return false
  return posts.every((p) => {
    const u = p?.unlocks
    const c = p?.comments
    const ur = Array.isArray(u) ? u[0] : u
    const cr = Array.isArray(c) ? c[0] : c
    const uc = ur?.count
    const cc = cr?.count
    const un = typeof uc === 'number' ? uc : Number(uc)
    const cn = typeof cc === 'number' ? cc : Number(cc)
    return Number.isFinite(un) && Number.isFinite(cn)
  })
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

const TEASER_CARD_MAX = 500
function truncateTeaserPreview(text, maxLen = TEASER_CARD_MAX) {
  const s = text != null ? String(text) : ''
  if (s.length <= maxLen) return s
  return `${s.slice(0, maxLen)}...`
}

export default function AuthorProfilePosts({ initialPosts, postsErrorMessage }) {
  const [sortMode, setSortMode] = useState('newest')
  const [timeFilter, setTimeFilter] = useState('all')
  const [mergedPosts, setMergedPosts] = useState([])
  const [countsLoading, setCountsLoading] = useState(true)
  const [currentPage, setCurrentPage] = useState(1)

  const basePosts = useMemo(() => initialPosts ?? [], [initialPosts])

  useEffect(() => {
    let cancelled = false

    async function loadCounts() {
      await Promise.resolve()
      if (cancelled) return

      if (basePosts.length === 0) {
        setMergedPosts([])
        setCountsLoading(false)
        return
      }

      const since = getSinceTimestamp(
        sortMode === 'unlocks' ? timeFilter : 'all',
      )

      if (since === null && postsHaveAllTimeCounts(basePosts)) {
        setMergedPosts(basePosts.map((p) => ({ ...p })))
        setCountsLoading(false)
        return
      }

      setCountsLoading(true)
      const postIds = basePosts.map((p) => p.id).filter(Boolean)

      const { error: unlockErr, rows: unlockRows } = await fetchAllUnlockCountRows(
        supabase,
        postIds,
        since,
      )
      const { data: commentCounts, error: commentErr } = await supabase.rpc(
        'get_comment_counts',
        { post_ids: postIds },
      )

      if (cancelled) return

      const unlockRowsSafe = unlockErr ? [] : (unlockRows ?? [])
      const commentRowsSafe = commentErr ? [] : (commentCounts ?? [])

      setMergedPosts(
        mergeUnlockAndCommentCounts(basePosts, unlockRowsSafe, commentRowsSafe),
      )
      setCountsLoading(false)
    }

    void loadCounts()

    return () => {
      cancelled = true
    }
  }, [basePosts, sortMode, timeFilter])

  const displayPosts = useMemo(() => {
    if (sortMode === 'newest') return sortPostsByNewest(mergedPosts)
    return sortPostsByUnlocksThenNewest(mergedPosts)
  }, [mergedPosts, sortMode])

  const totalPages = Math.max(1, Math.ceil(displayPosts.length / PAGE_SIZE))
  const effectivePage = Math.max(1, Math.min(currentPage, totalPages))

  const pagedPosts = useMemo(() => {
    const start = (effectivePage - 1) * PAGE_SIZE
    return displayPosts.slice(start, start + PAGE_SIZE)
  }, [displayPosts, effectivePage])

  const hasPrevPage = effectivePage > 1 && displayPosts.length > 0
  const hasNextPage = effectivePage < totalPages

  if (postsErrorMessage) {
    return (
      <section className="mt-10">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          Published posts
        </h2>
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-6 dark:border-red-900/50 dark:bg-red-950/40">
          <p className="text-sm text-red-800 dark:text-red-200">{postsErrorMessage}</p>
        </div>
      </section>
    )
  }

  if (basePosts.length === 0) {
    return (
      <section className="mt-10">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          Published posts
        </h2>
        <div className="mt-6 rounded-2xl border border-dashed border-zinc-300 bg-white/60 px-8 py-14 text-center dark:border-zinc-700 dark:bg-zinc-900/40">
          <p className="text-base text-zinc-700 dark:text-zinc-300">No posts yet</p>
        </div>
      </section>
    )
  }

  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        Published posts
      </h2>

      <div
        className="mt-6 mb-2 flex flex-wrap gap-1.5 md:gap-2"
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
            setTimeFilter('all')
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
                timeFilter === opt.id ? timeFilterBtnActive : timeFilterBtnInactive
              }
            >
              {opt.label}
            </button>
          ))}
        </div>
      ) : null}

      {countsLoading && mergedPosts.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Loading posts…</p>
      ) : (
        <>
        <ul className="flex flex-col gap-1.5 md:gap-2">
          {pagedPosts.map((post) => {
            const postHref = `/posts/${encodeURIComponent(post.slug)}`
            const priceLabel = formatXec(post.price_xec)
            const unlocksN = unlockCountFromPost(post)
            const commentsN = commentCountFromPost(post)
            const unlockStat =
              unlocksN === 1 ? '🔓 1 unlock' : `🔓 ${unlocksN} unlocks`
            const commentStat =
              commentsN === 1 ? '💬 1 comment' : `💬 ${commentsN} comments`
            const readTime = formatReadingTimeLabel(post.reading_time_minutes)

            return (
              <li key={post.id}>
                <article className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm transition hover:border-zinc-300 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700">
                  <h3 className="text-xl font-semibold leading-snug text-zinc-900 dark:text-zinc-50">
                    <Link
                      href={postHref}
                      className="transition hover:text-emerald-700 dark:hover:text-emerald-400"
                    >
                      {post.title}
                    </Link>
                  </h3>
                  <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                    <time dateTime={post.created_at ?? undefined}>
                      {formatPublishedDate(post.created_at)}
                    </time>
                    <span aria-hidden className="mx-2 text-zinc-300 dark:text-zinc-600">
                      ·
                    </span>
                    <span className="font-medium text-zinc-700 dark:text-zinc-300">
                      {priceLabel} XEC
                    </span>
                    <span aria-hidden className="mx-2 text-zinc-300 dark:text-zinc-600">
                      ·
                    </span>
                    <span className="font-medium text-zinc-700 dark:text-zinc-300">
                      {unlockStat}
                    </span>
                    <span aria-hidden className="mx-2 text-zinc-300 dark:text-zinc-600">
                      ·
                    </span>
                    <span className="font-medium text-zinc-700 dark:text-zinc-300">
                      {commentStat}
                    </span>
                    {readTime ? (
                      <>
                        <span aria-hidden className="mx-2 text-zinc-300 dark:text-zinc-600">
                          ·
                        </span>
                        <span className="font-medium text-zinc-700 dark:text-zinc-300">
                          {readTime}
                        </span>
                      </>
                    ) : null}
                  </p>
                  <p className="mt-4 whitespace-pre-wrap text-base leading-relaxed text-zinc-600 dark:text-zinc-400">
                    {truncateTeaserPreview(post.teaser)}
                  </p>
                </article>
              </li>
            )
          })}
        </ul>
        {displayPosts.length > PAGE_SIZE ? (
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
  )
}
