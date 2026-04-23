'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import FilterDropdown from '@/components/FilterDropdown'
import { formatReadingTimeLabel } from '@/lib/getReadingTime'
import { supabase } from '@/lib/supabase-browser'
import { fetchAllUnlockCountRows } from '@/lib/supabaseUnlockCounts'
import {
  fetchAllUnlockEarningsRows,
  sumAmountRowsByPostId,
} from '@/lib/supabaseUnlockEarnings'

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

function postDisplayTime(post) {
  return post.published_at ?? post.created_at
}

function sortPostsByUnlocksThenNewest(rows) {
  return [...rows].sort((a, b) => {
    const diff = unlockCountFromPost(b) - unlockCountFromPost(a)
    if (diff !== 0) return diff
    const ta = new Date(postDisplayTime(a)).getTime()
    const tb = new Date(postDisplayTime(b)).getTime()
    return tb - ta
  })
}

/** Primary sort key for earned: `post.earnings` when finite; else unlock count (home /api/posts gap on author SSR). */
function earnedPrimaryValue(post) {
  const e = Number(post.earnings)
  if (Number.isFinite(e)) return e
  return unlockCountFromPost(post)
}

function sortPostsByEarned(rows) {
  return [...rows].sort((a, b) => {
    const diff = earnedPrimaryValue(b) - earnedPrimaryValue(a)
    if (diff !== 0) return diff
    const ta = new Date(postDisplayTime(a)).getTime()
    const tb = new Date(postDisplayTime(b)).getTime()
    return tb - ta
  })
}

function sortPostsByNewest(rows) {
  return [...rows].sort((a, b) => {
    const tb = new Date(postDisplayTime(b)).getTime()
    const ta = new Date(postDisplayTime(a)).getTime()
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

const AUTHOR_SORT_OPTIONS = [
  { value: 'earned', label: 'Most earned' },
  { value: 'unlocks', label: 'Most unlocked' },
  { value: 'newest', label: 'Newest' },
]

const AUTHOR_TIME_OPTIONS = [
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: '1y', label: '1y' },
  { value: 'all', label: 'All time' },
]

const MENU_SORT = 'author-posts-sort'
const MENU_TIME = 'author-posts-time'

const TEASER_CARD_MAX = 500
function truncateTeaserPreview(text, maxLen = TEASER_CARD_MAX) {
  const s = text != null ? String(text) : ''
  if (s.length <= maxLen) return s
  return `${s.slice(0, maxLen)}...`
}

function PostCard({ post }) {
  const postHref = post.legacy
    ? `/${encodeURIComponent(post.slug)}`
    : `/posts/${encodeURIComponent(post.slug)}`
  const priceLabel = formatXec(post.price_xec)
  const unlocksN = unlockCountFromPost(post)
  const commentsN = commentCountFromPost(post)
  const unlockStat = unlocksN === 1 ? '🔓 1 unlock' : `🔓 ${unlocksN} unlocks`
  const commentStat = commentsN === 1 ? '💬 1 comment' : `💬 ${commentsN} comments`
  const readTime = formatReadingTimeLabel(post.reading_time_minutes)

  return (
    <li>
      <article className="relative overflow-hidden rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm transition hover:border-zinc-300 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700">
        <h3 className="text-xl font-semibold leading-snug text-zinc-900 dark:text-zinc-50">
          <Link
            href={postHref}
            className="transition after:absolute after:inset-0 after:content-[''] hover:text-emerald-700 dark:hover:text-emerald-400"
          >
            {post.title}
          </Link>
        </h3>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          <time dateTime={postDisplayTime(post) ?? undefined}>
            {formatPublishedDate(postDisplayTime(post))}
          </time>
          <span aria-hidden className="mx-2 text-zinc-300 dark:text-zinc-600">·</span>
          <span className="font-medium text-zinc-700 dark:text-zinc-300">{priceLabel} XEC</span>
          <span aria-hidden className="mx-2 text-zinc-300 dark:text-zinc-600">·</span>
          <span className="font-medium text-zinc-700 dark:text-zinc-300">{unlockStat}</span>
          <span aria-hidden className="mx-2 text-zinc-300 dark:text-zinc-600">·</span>
          <span className="font-medium text-zinc-700 dark:text-zinc-300">{commentStat}</span>
          {readTime ? (
            <>
              <span aria-hidden className="mx-2 text-zinc-300 dark:text-zinc-600">·</span>
              <span className="font-medium text-zinc-700 dark:text-zinc-300">{readTime}</span>
            </>
          ) : null}
        </p>
        <p className="mt-4 break-words line-clamp-4 overflow-hidden text-base leading-relaxed text-zinc-600 dark:text-zinc-400">
          {truncateTeaserPreview(post.teaser)}
        </p>
      </article>
    </li>
  )
}

export default function AuthorProfilePosts({ initialPosts, postsErrorMessage }) {
  const [sortMode, setSortMode] = useState('earned')
  const [timeFilter, setTimeFilter] = useState('24h')
  const [openMenu, setOpenMenu] = useState(/** @type {string | null} */ (null))
  const [mergedPosts, setMergedPosts] = useState([])
  const [countsLoading, setCountsLoading] = useState(true)
  const [currentPage, setCurrentPage] = useState(1)
  const [legacySectionOpen, setLegacySectionOpen] = useState(false)
  const [mergedLegacyPosts, setMergedLegacyPosts] = useState([])
  const [legacyCountsLoading, setLegacyCountsLoading] = useState(false)

  const basePosts = useMemo(() => initialPosts ?? [], [initialPosts])

  const nonLegacyBase = useMemo(
    () => basePosts.filter((p) => p.legacy !== true),
    [basePosts],
  )
  const legacyBase = useMemo(
    () => basePosts.filter((p) => p.legacy === true),
    [basePosts],
  )

  useEffect(() => {
    setCurrentPage(1)
  }, [sortMode, timeFilter])

  // Load counts for non-legacy posts only (mirrors dashboard: main list excludes legacy)
  useEffect(() => {
    let cancelled = false

    async function loadCounts() {
      await Promise.resolve()
      if (cancelled) return

      if (nonLegacyBase.length === 0) {
        setMergedPosts([])
        setCountsLoading(false)
        return
      }

      const since = getSinceTimestamp(
        sortMode === 'unlocks' || sortMode === 'earned' ? timeFilter : 'all',
      )

      const canSkipCountsFetch =
        since === null && sortMode !== 'earned' && postsHaveAllTimeCounts(nonLegacyBase)

      if (canSkipCountsFetch) {
        setMergedPosts(nonLegacyBase.map((p) => ({ ...p })))
        setCountsLoading(false)
        return
      }

      setCountsLoading(true)
      const postIds = nonLegacyBase.map((p) => p.id).filter(Boolean)

      const unlockPromise = fetchAllUnlockCountRows(supabase, postIds, since)
      const commentPromise = supabase.rpc('get_comment_counts', { post_ids: postIds })
      const earningsPromise =
        sortMode === 'earned'
          ? fetchAllUnlockEarningsRows(supabase, postIds, since)
          : Promise.resolve({ error: null, rows: [] })

      const [{ error: unlockErr, rows: unlockRows }, commentRes, earningsRes] =
        await Promise.all([unlockPromise, commentPromise, earningsPromise])

      if (cancelled) return

      const unlockRowsSafe = unlockErr ? [] : (unlockRows ?? [])
      const commentRowsSafe = commentRes.error ? [] : (commentRes.data ?? [])
      const earningsRowsSafe =
        sortMode === 'earned' && !earningsRes.error ? (earningsRes.rows ?? []) : []

      let merged = mergeUnlockAndCommentCounts(
        nonLegacyBase,
        unlockRowsSafe,
        commentRowsSafe,
      )
      if (sortMode === 'earned' && !earningsRes.error) {
        const earningsById = sumAmountRowsByPostId(earningsRowsSafe)
        merged = merged.map((p) => ({
          ...p,
          earnings: earningsById[p.id] ?? 0,
        }))
      }

      setMergedPosts(merged)
      setCountsLoading(false)
    }

    void loadCounts()
    return () => {
      cancelled = true
    }
  }, [nonLegacyBase, sortMode, timeFilter])

  // Legacy: same unlock `since` rule as dashboard; comments always all-time RPC.
  // Fetches only when the collapsible is open.
  useEffect(() => {
    if (!legacySectionOpen || legacyBase.length === 0) return

    let cancelled = false

    async function loadLegacyCounts() {
      const since = getSinceTimestamp(
        sortMode === 'unlocks' || sortMode === 'earned' ? timeFilter : 'all',
      )

      const canSkipLegacy =
        since === null && sortMode !== 'earned' && postsHaveAllTimeCounts(legacyBase)

      if (canSkipLegacy) {
        setMergedLegacyPosts(legacyBase.map((p) => ({ ...p })))
        setLegacyCountsLoading(false)
        return
      }

      setLegacyCountsLoading(true)
      const postIds = legacyBase.map((p) => p.id).filter(Boolean)

      const unlockPromise = fetchAllUnlockCountRows(supabase, postIds, since)
      const commentPromise = supabase.rpc('get_comment_counts', { post_ids: postIds })
      const earningsPromise =
        sortMode === 'earned'
          ? fetchAllUnlockEarningsRows(supabase, postIds, since)
          : Promise.resolve({ error: null, rows: [] })

      const [{ error: unlockErr, rows: unlockRows }, commentRes, earningsRes] =
        await Promise.all([unlockPromise, commentPromise, earningsPromise])

      if (cancelled) return

      const unlockRowsSafe = unlockErr ? [] : (unlockRows ?? [])
      const commentRowsSafe = commentRes.error ? [] : (commentRes.data ?? [])
      const earningsRowsSafe =
        sortMode === 'earned' && !earningsRes.error ? (earningsRes.rows ?? []) : []

      let mergedLegacy = mergeUnlockAndCommentCounts(
        legacyBase,
        unlockRowsSafe,
        commentRowsSafe,
      )
      if (sortMode === 'earned' && !earningsRes.error) {
        const earningsById = sumAmountRowsByPostId(earningsRowsSafe)
        mergedLegacy = mergedLegacy.map((p) => ({
          ...p,
          earnings: earningsById[p.id] ?? 0,
        }))
      }

      setMergedLegacyPosts(mergedLegacy)
      setLegacyCountsLoading(false)
    }

    void loadLegacyCounts()
    return () => {
      cancelled = true
    }
  }, [legacySectionOpen, legacyBase, sortMode, timeFilter])

  const legacyById = useMemo(() => {
    const map = {}
    for (const p of mergedLegacyPosts) {
      if (p?.id) map[p.id] = p
    }
    return map
  }, [mergedLegacyPosts])

  const legacyDisplayRows = useMemo(() => {
    const mergedRows = legacyBase.map((p) => legacyById[p.id] ?? p)
    if (sortMode === 'newest') return sortPostsByNewest(mergedRows)
    if (sortMode === 'earned') return sortPostsByEarned(mergedRows)
    return sortPostsByUnlocksThenNewest(mergedRows)
  }, [legacyBase, legacyById, sortMode])

  const displayPosts = useMemo(() => {
    if (sortMode === 'newest') return sortPostsByNewest(mergedPosts)
    if (sortMode === 'earned') return sortPostsByEarned(mergedPosts)
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
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Posts</h2>
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-6 dark:border-red-900/50 dark:bg-red-950/40">
          <p className="text-sm text-red-800 dark:text-red-200">{postsErrorMessage}</p>
        </div>
      </section>
    )
  }

  if (basePosts.length === 0) {
    return (
      <section className="mt-10">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Posts</h2>
        <div className="mt-6 rounded-2xl border border-dashed border-zinc-300 bg-white/60 px-8 py-14 text-center dark:border-zinc-700 dark:bg-zinc-900/40">
          <p className="text-base text-zinc-700 dark:text-zinc-300">No posts yet</p>
        </div>
      </section>
    )
  }

  return (
    <>
      <section className="mt-10">
        {nonLegacyBase.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-dashed border-zinc-300 bg-white/60 px-8 py-14 text-center dark:border-zinc-700 dark:bg-zinc-900/40">
            <p className="text-base text-zinc-700 dark:text-zinc-300">No posts yet</p>
          </div>
        ) : (
          <>
            <div className="mt-6 mb-3 flex items-center gap-2 sm:gap-4">
              <h2 className="hidden min-[360px]:block text-2xl font-semibold tracking-tight text-zinc-900 sm:text-3xl dark:text-zinc-50">
                Posts
              </h2>
              <div className="ml-auto flex shrink-0 items-center gap-1.5">
                <FilterDropdown
                  menuId={MENU_SORT}
                  openMenu={openMenu}
                  setOpenMenu={setOpenMenu}
                  value={sortMode}
                  options={AUTHOR_SORT_OPTIONS}
                  ariaLabel="Sort posts"
                  onChange={(v) => setSortMode(v)}
                />
                <FilterDropdown
                  menuId={MENU_TIME}
                  openMenu={openMenu}
                  setOpenMenu={setOpenMenu}
                  value={timeFilter}
                  options={AUTHOR_TIME_OPTIONS}
                  ariaLabel="Time range for unlocks and earnings"
                  disabled={sortMode === 'newest'}
                  disabledHint="Time range does not apply when sorting by Newest."
                  onChange={(v) => setTimeFilter(v)}
                />
              </div>
            </div>

            {countsLoading && mergedPosts.length === 0 ? (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">Loading posts…</p>
            ) : (
              <>
                <ul className="flex flex-col gap-1.5 md:gap-2">
                  {pagedPosts.map((post) => (
                    <PostCard key={post.id} post={post} />
                  ))}
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
          </>
        )}
      </section>

      {legacyBase.length > 0 ? (
        <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <button
            type="button"
            onClick={() => setLegacySectionOpen((open) => !open)}
            aria-expanded={legacySectionOpen}
            className="flex w-full items-center justify-between gap-3 text-left"
          >
            <h2 className="text-base font-semibold text-zinc-600 dark:text-zinc-400">
              Legacy Posts ({legacyBase.length})
            </h2>
            <span className="shrink-0 text-zinc-500 tabular-nums dark:text-zinc-500" aria-hidden>
              {legacySectionOpen ? '▾' : '▸'}
            </span>
          </button>
          {legacySectionOpen ? (
            legacyCountsLoading ? (
              <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">Loading posts…</p>
            ) : (
              <ul className="mt-4 flex flex-col gap-1.5 md:gap-2">
                {legacyDisplayRows.map((post) => (
                  <PostCard key={post.id} post={post} />
                ))}
              </ul>
            )
          ) : null}
        </section>
      ) : null}
    </>
  )
}
