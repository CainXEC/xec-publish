'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import FilterDropdown from '@/components/FilterDropdown'
import DashboardHandleCarousel from '@/components/dashboard/DashboardHandleCarousel'
import { FEED_CSS } from '@/components/feed/feedTheme'
import FeedTopbar from '@/components/feed/FeedTopbar'
import BellIcon from '@/components/BellIcon'
import { formatReadingTimeLabel } from '@/lib/getReadingTime'
import { supabase } from '@/lib/supabase-browser'
import { fetchAllUnlockCountRows } from '@/lib/supabaseUnlockCounts'
import {
  fetchAllUnlockEarningsRows,
  sumAmountRowsByPostId,
} from '@/lib/supabaseUnlockEarnings'
import { deletePost } from '@/app/dashboard/deletePost'

const PAGE_SIZE = 25

function formatXec(amount) {
  const n = Number(amount)
  if (!Number.isFinite(n)) return '0'
  return n.toFixed(8).replace(/\.?0+$/, '')
}

const DELETE_CONFIRM =
  'Are you sure you want to delete this post? This cannot be undone.'

const DASHBOARD_SORT_OPTIONS = [
  { value: 'earned', label: 'Most earned' },
  { value: 'unlocks', label: 'Most unlocked' },
  { value: 'newest', label: 'Newest' },
  { value: 'drafts', label: 'Drafts' },
]

const MENU_SORT = 'dashboard-posts-sort'
const SORT_PILL_MIN_WIDTH = '15ch'

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

function sortRowsWithZeroTail(rows, getMetric) {
  const withMetric = rows.filter((row) => getMetric(row) > 0)
  const withoutMetric = rows.filter((row) => getMetric(row) <= 0)

  withMetric.sort((a, b) => {
    const diff = getMetric(b) - getMetric(a)
    if (diff !== 0) return diff
    const ta = new Date(a.created_at).getTime()
    const tb = new Date(b.created_at).getTime()
    return tb - ta
  })

  withoutMetric.sort((a, b) => {
    const ta = new Date(a.created_at).getTime()
    const tb = new Date(b.created_at).getTime()
    return tb - ta
  })

  return [...withMetric, ...withoutMetric]
}

function sortPostsByUnlocksThenNewest(rows) {
  return sortRowsWithZeroTail(rows, unlockCountFromPost)
}

function sortPostsByNewest(rows) {
  const byCreatedDesc = (a, b) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  // Published posts are ordered by when they went live (published_at), not when
  // the draft was first created — so the most recently published sits on top.
  const publishedTime = (p) =>
    new Date(p.published_at ?? p.created_at).getTime()
  const byPublishedDesc = (a, b) => publishedTime(b) - publishedTime(a)
  const drafts = rows.filter((p) => !p.published)
  const published = rows.filter((p) => p.published)
  drafts.sort(byCreatedDesc)
  published.sort(byPublishedDesc)
  return [...drafts, ...published]
}

function earnedPrimaryValue(post) {
  const e = Number(post.earnings)
  if (Number.isFinite(e)) return e
  return unlockCountFromPost(post)
}

function sortPostsByEarned(rows) {
  return sortRowsWithZeroTail(rows, earnedPrimaryValue)
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

function DashboardPostCard({
  post,
  deletingId,
  onDelete,
}) {
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
    <li className="dashpost">
      <div className="dashpost-row">
        <div className="dashpost-main">
          <div className="dashpost-titlerow">
            {publicHref ? (
              <Link
                href={publicHref}
                target="_blank"
                rel="noopener noreferrer"
                className="dashpost-title"
              >
                {post.title ?? 'Untitled post'}
              </Link>
            ) : (
              <p className="dashpost-title">
                {post.title ?? 'Untitled post'}
              </p>
            )}
            {!post.published ? <span className="dashdraft">Draft</span> : null}
          </div>
          <p className="dashpost-meta">
            <span className="dashpost-price">{priceLabel} XEC</span>
            <span>{unlockStat}</span>
            {readTime ? <span>{readTime}</span> : null}
          </p>
        </div>
        <div className="dashpost-btns">
          {!post.published ? (
            <Link
              href={`/dashboard/preview/${encodeURIComponent(post.id)}`}
              className="dashmini warn"
            >
              Preview
            </Link>
          ) : null}
          <Link
            href={`/dashboard/edit/${encodeURIComponent(post.id)}`}
            className="dashmini"
          >
            Edit
          </Link>
          <button
            type="button"
            onClick={() => void onDelete()}
            disabled={deletingId !== null}
            className="dashmini danger"
          >
            {deletingId === post.id ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </li>
  )
}

export default function DashboardClient({
  identity,
  handleColor = null,
  profileHref,
  bio,
  xecAddress,
  notifications,
  initialPosts,
  loadError,
  initialTotalUnlocks,
  initialTotalXecRaw,
}) {
  const [posts, setPosts] = useState(initialPosts)
  const [sortMode, setSortMode] = useState('newest')
  const [unlockCountMap, setUnlockCountMap] = useState({})
  const [earningsMap, setEarningsMap] = useState({})
  const [deleteError, setDeleteError] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [openMenu, setOpenMenu] = useState(/** @type {string | null} */ (null))
  const [copiedAddress, setCopiedAddress] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [unreadNotifications, setUnreadNotifications] = useState(
    () => (notifications ?? []).map((n) => ({ ...n, read: Boolean(n.read) })),
  )
  const [legacySectionOpen, setLegacySectionOpen] = useState(false)
  const copyTimeoutRef = useRef(null)

  // Stats come from the server — no loading state needed
  const totalUnlocks = typeof initialTotalUnlocks === 'number' ? initialTotalUnlocks : 0
  const totalXecEarned = typeof initialTotalXecRaw === 'number' ? initialTotalXecRaw / 100 : 0

  useEffect(() => {
    setPosts(initialPosts)
  }, [initialPosts])

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
    setCurrentPage(1)
  }, [sortMode])

  const nonLegacyPosts = useMemo(
    () => posts.filter((p) => p.legacy !== true),
    [posts],
  )
  const draftPosts = useMemo(
    () => nonLegacyPosts.filter((p) => !p.published),
    [nonLegacyPosts],
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
      const sourceLegacy = legacyPosts
      const postIds = sourceLegacy.map((p) => p.id).filter(Boolean)
      if (postIds.length === 0) return
      const unlockPromise = fetchAllUnlockCountRows(supabase, postIds, null)
      const earningsPromise =
        sortMode === 'earned'
          ? fetchAllUnlockEarningsRows(supabase, postIds, null)
          : Promise.resolve({ error: null, rows: [] })
      const [{ error, rows }, earningsRes] = await Promise.all([
        unlockPromise,
        earningsPromise,
      ])
      if (cancelled) return
      if (error) return
      const patch = countRowsByPostId(rows ?? [])
      setUnlockCountMap((prev) => ({ ...prev, ...patch }))
      if (sortMode === 'earned' && !earningsRes.error) {
        const earningsPatch = sumAmountRowsByPostId(earningsRes.rows ?? [])
        setEarningsMap((prev) => ({ ...prev, ...earningsPatch }))
      }
    }

    void loadLegacyUnlockCounts()
    return () => {
      cancelled = true
    }
  }, [legacySectionOpen, legacyPosts, sortMode])

  useEffect(() => {
    let cancelled = false

    async function loadUnlockCounts() {
      if (sortMode === 'drafts') {
        setUnlockCountMap({})
        setEarningsMap({})
        return
      }
      const postIds = nonLegacyPosts.map((p) => p.id).filter(Boolean)
      if (postIds.length === 0) {
        setUnlockCountMap({})
        setEarningsMap({})
        return
      }

      const unlockPromise = fetchAllUnlockCountRows(supabase, postIds, null)
      const earningsPromise =
        sortMode === 'earned'
          ? fetchAllUnlockEarningsRows(supabase, postIds, null)
          : Promise.resolve({ error: null, rows: [] })

      const [{ error, rows }, earningsRes] = await Promise.all([
        unlockPromise,
        earningsPromise,
      ])

      if (cancelled) return

      if (error) {
        setUnlockCountMap({})
        setEarningsMap({})
        return
      }

      setUnlockCountMap(countRowsByPostId(rows ?? []))
      if (sortMode === 'earned' && !earningsRes.error) {
        setEarningsMap(sumAmountRowsByPostId(earningsRes.rows ?? []))
      } else if (sortMode !== 'earned') {
        setEarningsMap({})
      }
    }

    void loadUnlockCounts()

    return () => {
      cancelled = true
    }
  }, [nonLegacyPosts, sortMode])

  const sortedPosts = useMemo(() => {
    if (sortMode === 'drafts') return sortPostsByNewest(draftPosts)
    const sourcePosts = nonLegacyPosts
    const withCounts = sourcePosts.map((p) => ({
      ...p,
      unlocks: [{ count: unlockCountMap[p.id] ?? 0 }],
      earnings: earningsMap[p.id],
    }))
    if (sortMode === 'newest') return sortPostsByNewest(withCounts)
    if (sortMode === 'earned') return sortPostsByEarned(withCounts)
    return sortPostsByUnlocksThenNewest(withCounts)
  }, [draftPosts, earningsMap, nonLegacyPosts, sortMode, unlockCountMap])

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
      const result = await deletePost(postId)
      if (!result.ok) {
        setDeleteError(result.error || 'Could not delete this post.')
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
      <div className="pow-feed">
        <style>{FEED_CSS}</style>
        <FeedTopbar signedIn isAuthor showLogout showDashboard={false} />
        <main className="wrap" style={{ paddingTop: '28px' }}>
          <div className="error">{loadError}</div>
          <p style={{ marginTop: '16px' }}>
            <Link href="/dashboard" className="back">
              Try again
            </Link>
          </p>
        </main>
      </div>
    )
  }

  return (
    <div className="pow-feed">
      <style>{FEED_CSS}</style>

      <FeedTopbar signedIn isAuthor showLogout showDashboard={false} />

      <main className="wrap" style={{ paddingTop: '28px' }}>
        <div className="dashpanel">
          <div className="dashtop">
            <h1 className="dashwelcome">
              Welcome{' '}
              <Link
                href={profileHref}
                style={identity?.startsWith('@') && handleColor ? { color: handleColor } : undefined}
              >
                {identity?.startsWith('@')
                  ? identity.slice(1)
                  : identity?.length <= 16
                    ? identity
                    : `${identity.slice(0, 10)}…${identity.slice(-4)}`}
              </Link>
              !
            </h1>
            <button
              type="button"
              onClick={() => setNotificationsOpen((open) => !open)}
              className="dashbell"
              aria-label="Toggle notifications"
              aria-expanded={notificationsOpen}
            >
              <BellIcon size={17} />
              {unreadNotificationCount > 0 ? (
                <span className="dashbadge">{unreadNotificationCount}</span>
              ) : null}
            </button>
          </div>

          <div className="dashstats">
            <div className="dashstat">
              <p className="dashstat-label">Total Unlocks</p>
              <p className="dashstat-value">
                <span aria-hidden>🔓 </span>
                {totalUnlocks}
              </p>
            </div>
            <div className="dashstat">
              <p className="dashstat-label">Total Earned</p>
              <p className="dashstat-value">
                <span aria-hidden>💰 </span>
                {Math.round(totalXecEarned).toLocaleString('en-US')} XEC
              </p>
            </div>
          </div>

          {bio ? <p className="dashbio">{bio}</p> : null}
          {xecAddress ? (
            <>
              <p
                className="dashaddr"
                onClick={() => void handleCopyXecAddress()}
                title="Click to copy"
              >
                {xecAddress}
              </p>
              {copiedAddress ? <p className="dashcopied">Copied!</p> : null}
            </>
          ) : null}

          <DashboardHandleCarousel />

          {notificationsOpen ? (
            <div className="dashnotifs">
              <div className="dashnotifs-head">
                <p className="dashnotifs-title">Notifications</p>
                {unreadNotificationCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => void handleMarkAllRead()}
                    className="linkbtn"
                  >
                    Mark all read
                  </button>
                ) : null}
              </div>
              {unreadNotifications.length === 0 ? (
                <p className="dashnotif-msg">No new notifications</p>
              ) : (
                <ul className="dashnotifs-list">
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
                    const highlight =
                      message.toLowerCase().includes('comment') ||
                      message.toLowerCase().includes('follow')
                    return (
                      <li key={n.id}>
                        <Link
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`dashnotif${highlight ? ' hl' : ''}${n.read ? ' read' : ''}`}
                        >
                          <p className="dashnotif-msg">{message}</p>
                          <p className="dashnotif-time">{formatRelativeTime(n.created_at)}</p>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          ) : null}

          <div className="dashactions">
            <Link href="/dashboard/new-post" className="dashbtn">
              Write New Post
            </Link>
            <Link href="/dashboard/profile" className="dashbtn sec">
              Edit Profile
            </Link>
          </div>
        </div>

        <section className="dashpanel">
          <div className="dashsection-head">
            <h2 className="dashsection-title">Your Posts</h2>
            {nonLegacyPosts.length > 0 ? (
              <FilterDropdown
                menuId={MENU_SORT}
                openMenu={openMenu}
                setOpenMenu={setOpenMenu}
                value={sortMode}
                options={DASHBOARD_SORT_OPTIONS}
                ariaLabel="Sort posts"
                onChange={(v) => setSortMode(v)}
                minWidth={SORT_PILL_MIN_WIDTH}
              />
            ) : null}
          </div>

          {deleteError ? (
            <div className="error" role="alert">
              {deleteError}
            </div>
          ) : null}

          {nonLegacyPosts.length === 0 ? (
            <div className="empty">
              <p>Welcome to Proof Of Writing! Create your first post to get started.</p>
              <p style={{ marginTop: '16px' }}>
                <Link href="/dashboard/new-post" className="dashbtn">
                  Create your first post
                </Link>
              </p>
            </div>
          ) : (
            <>
              {sortedPosts.length === 0 ? (
                <div className="empty">
                  {sortMode === 'drafts' ? 'No drafts yet.' : 'No posts found.'}
                </div>
              ) : (
                <ul className="dashlist">
                  {pagedSortedPosts.map((post) => (
                    <DashboardPostCard
                      key={post.id}
                      post={post}
                      deletingId={deletingId}
                      onDelete={() => void handleDeletePost(post.id)}
                    />
                  ))}
                </ul>
              )}
              {sortedPosts.length > PAGE_SIZE ? (
                <div className="dashpager">
                  <div className="dashpager-side">
                    {hasPrevPage ? (
                      <button
                        type="button"
                        onClick={() => setCurrentPage(effectivePage - 1)}
                        className="ghost"
                      >
                        ← Page {effectivePage - 1}
                      </button>
                    ) : null}
                  </div>
                  <span className="dashpager-mid">
                    Page {effectivePage} of {totalPages}
                  </span>
                  <div className="dashpager-side dashpager-end">
                    {hasNextPage ? (
                      <button
                        type="button"
                        onClick={() => setCurrentPage(effectivePage + 1)}
                        className="ghost"
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
          <section className="dashpanel">
            <button
              type="button"
              onClick={() => setLegacySectionOpen((open) => !open)}
              aria-expanded={legacySectionOpen}
              className="dashlegacy-toggle"
            >
              <span>Legacy Posts ({legacyPosts.length})</span>
              <span aria-hidden>{legacySectionOpen ? '▾' : '▸'}</span>
            </button>
            {legacySectionOpen ? (
              <ul className="dashlist">
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