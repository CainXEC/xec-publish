'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import FilterDropdown from '@/components/FilterDropdown'
import { FEED_CSS } from '@/components/feed/feedTheme'
import FeedTopbar from '@/components/feed/FeedTopbar'
import FeedPost from '@/components/feed/FeedPost'
import UnlockIcon from '@/components/UnlockIcon'
import EcashIcon from '@/components/EcashIcon'
import { formatReadingTimeLabel } from '@/lib/getReadingTime'
import { supabase } from '@/lib/supabase-browser'
import { fetchAllUnlockCountRows } from '@/lib/supabaseUnlockCounts'
import {
  fetchAllUnlockEarningsRows,
  sumAmountRowsByPostId,
} from '@/lib/supabaseUnlockEarnings'
import { deletePost } from '@/app/dashboard/deletePost'

const PAGE_SIZE = 25

// Append a new page of feed items, dropping any txid already shown (the pinned
// post is prepended to page 1 and excluded from later pages, but dedupe anyway).
function appendUnique(prev, more) {
  const seen = new Set((prev ?? []).map((p) => p.txid))
  return [...(prev ?? []), ...(more ?? []).filter((p) => p.txid && !seen.has(p.txid))]
}

// Pinned locale + UTC timezone so the server and the client hydrate identical
// text (an un-pinned toLocaleDateString disagrees across zones → React #418).
function formatShortDate(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

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

const LIBRARY_SORT_OPTIONS = [
  { value: 'recent', label: 'Recently unlocked' },
  { value: 'spent', label: 'Highest price' },
  { value: 'az', label: 'A–Z' },
]

const MENU_SORT = 'dashboard-posts-sort'
const MENU_LIBRARY_SORT = 'dashboard-library-sort'
const SORT_PILL_MIN_WIDTH = '15ch'

/** One unlocked article in the Library tab: read-only — the reader owns the
 *  entitlement, not the piece, so there are no edit/delete controls. */
function LibraryCard({ item }) {
  const href = item.legacy
    ? `/${encodeURIComponent(item.slug)}`
    : `/posts/${encodeURIComponent(item.slug)}`
  const readTime = formatReadingTimeLabel(item.readMinutes)
  const unlockedLabel = formatShortDate(item.unlockedAt)
  return (
    <li className="dashpost">
      <div className="dashpost-row">
        <div className="dashpost-main">
          <div className="dashpost-titlerow">
            <Link href={href} target="_blank" rel="noopener noreferrer" className="dashpost-title">
              {item.title}
            </Link>
          </div>
          <p className="dashpost-meta">
            <span className="dashpost-price">{formatXec(item.priceXec)} XEC</span>
            <span>by {item.author}</span>
            {readTime ? <span>{readTime}</span> : null}
            {unlockedLabel ? <span>unlocked {unlockedLabel}</span> : null}
          </p>
        </div>
        <div className="dashpost-btns">
          <Link href={href} target="_blank" rel="noopener noreferrer" className="dashmini">
            Read
          </Link>
        </div>
      </div>
    </li>
  )
}

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

function DashboardPostCard({
  post,
  deletingId,
  onDelete,
}) {
  const n = unlockCountFromPost(post)
  const unlockStat = n === 1 ? '🔓 1 unlock' : `🔓 ${n} unlocks`
  const readTime = formatReadingTimeLabel(post.reading_time_minutes)
  const priceLabel = formatXec(post.price_xec)
  // Published pieces show when they went live (paid-flow posts keep that in
  // created_at); drafts show when they were started.
  const wentLiveIso = post.published_at ?? post.created_at
  const dateLabel = formatShortDate(wentLiveIso)
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
            {dateLabel ? (
              <span>{post.published ? dateLabel : `started ${dateLabel}`}</span>
            ) : null}
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
  initialPosts,
  loadError,
  initialTotalUnlocks,
  initialWalletXecRaw,
  walletBalanceSlot = null,
  viewerAccountId = null,
  initialFeedPosts = [],
  initialFeedNextCursor = null,
  initialFeedReplies = null,
  library = [],
  followers = [],
  following = [],
}) {
  const [posts, setPosts] = useState(initialPosts)
  // Articles opens on Drafts when there's unfinished writing to get back to —
  // the thing you most likely came for — and on Newest otherwise. Decided once
  // from the server-provided list (same non-legacy + unpublished test as
  // draftPosts below); switching the filter afterwards is untouched.
  const [sortMode, setSortMode] = useState(() =>
    (initialPosts ?? []).some((p) => p.legacy !== true && !p.published)
      ? 'drafts'
      : 'newest',
  )
  const [librarySort, setLibrarySort] = useState('recent')
  // Which follow list is open under the stat band: null | 'followers' | 'following'
  const [followsOpen, setFollowsOpen] = useState(null)
  const sortedLibrary = useMemo(() => {
    const rows = [...library]
    if (librarySort === 'spent') {
      rows.sort((a, b) => (Number(b.priceXec) || 0) - (Number(a.priceXec) || 0))
    } else if (librarySort === 'az') {
      rows.sort((a, b) => String(a.title).localeCompare(String(b.title)))
    } else {
      rows.sort(
        (a, b) => new Date(b.unlockedAt ?? 0).getTime() - new Date(a.unlockedAt ?? 0).getTime(),
      )
    }
    return rows
  }, [library, librarySort])
  const [unlockCountMap, setUnlockCountMap] = useState({})
  const [earningsMap, setEarningsMap] = useState({})
  const [deleteError, setDeleteError] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [openMenu, setOpenMenu] = useState(/** @type {string | null} */ (null))
  const [copiedAddress, setCopiedAddress] = useState(false)
  const [legacySectionOpen, setLegacySectionOpen] = useState(false)
  const copyTimeoutRef = useRef(null)

  // Three-tab view (Posts / Replies / Articles), mirroring the profile page.
  // Posts & Replies are the account's own feed items; Articles is the paywalled
  // article manager below. New accounts land on Posts.
  const [tab, setTab] = useState('posts')
  const [feedPosts, setFeedPosts] = useState(initialFeedPosts ?? [])
  // Cursor for the Posts tab: page 1 is server-rendered; "Load more" pages the
  // rest via /api/feed/account-posts (null cursor = no more). Without this the
  // dashboard only ever showed the first page of your posts.
  const [feedPostsCursor, setFeedPostsCursor] = useState(initialFeedNextCursor)
  const [feedPostsLoadingMore, setFeedPostsLoadingMore] = useState(false)
  const loadMoreFeedPosts = useCallback(async () => {
    if (!viewerAccountId || !feedPostsCursor || feedPostsLoadingMore) return
    setFeedPostsLoadingMore(true)
    try {
      const res = await fetch(
        `/api/feed/account-posts?accountId=${encodeURIComponent(viewerAccountId)}&cursor=${encodeURIComponent(feedPostsCursor)}`,
      )
      const data = await res.json()
      if (data.ok) {
        setFeedPosts((prev) => appendUnique(prev, data.posts))
        setFeedPostsCursor(data.nextCursor ?? null)
      }
    } catch {
      /* leave the cursor in place — clicking again retries */
    } finally {
      setFeedPostsLoadingMore(false)
    }
  }, [viewerAccountId, feedPostsCursor, feedPostsLoadingMore])
  // Replies load ON DEMAND: null = not fetched yet. The first switch to the
  // Replies tab fetches them from /api/feed/account-replies (same shape as the
  // server used to inline), so the dashboard render never waits on them.
  const [feedReplies, setFeedReplies] = useState(initialFeedReplies)
  const [feedRepliesLoading, setFeedRepliesLoading] = useState(false)
  const [feedRepliesCursor, setFeedRepliesCursor] = useState(null)
  const [feedRepliesLoadingMore, setFeedRepliesLoadingMore] = useState(false)
  const loadFeedReplies = useCallback(async () => {
    if (!viewerAccountId) { setFeedReplies((prev) => prev ?? []); return }
    setFeedRepliesLoading(true)
    try {
      const res = await fetch(
        `/api/feed/account-replies?accountId=${encodeURIComponent(viewerAccountId)}`,
      )
      const data = await res.json()
      setFeedReplies(Array.isArray(data.posts) ? data.posts : [])
      setFeedRepliesCursor(data.nextCursor ?? null)
    } catch {
      setFeedReplies([])
    } finally {
      setFeedRepliesLoading(false)
    }
  }, [viewerAccountId])
  const loadMoreFeedReplies = useCallback(async () => {
    if (!viewerAccountId || !feedRepliesCursor || feedRepliesLoadingMore) return
    setFeedRepliesLoadingMore(true)
    try {
      const res = await fetch(
        `/api/feed/account-replies?accountId=${encodeURIComponent(viewerAccountId)}&cursor=${encodeURIComponent(feedRepliesCursor)}`,
      )
      const data = await res.json()
      if (data.ok) {
        setFeedReplies((prev) => appendUnique(prev, data.posts))
        setFeedRepliesCursor(data.nextCursor ?? null)
      }
    } catch {
      /* leave the cursor in place — clicking again retries */
    } finally {
      setFeedRepliesLoadingMore(false)
    }
  }, [viewerAccountId, feedRepliesCursor, feedRepliesLoadingMore])
  const openRepliesTab = useCallback(() => {
    setTab('replies')
    if (feedReplies === null && !feedRepliesLoading) void loadFeedReplies()
  }, [feedReplies, feedRepliesLoading, loadFeedReplies])
  // Deleting one of your own feed items drops it from whichever tab holds it.
  const removeFeedItem = useCallback((txid) => {
    setFeedPosts((prev) => prev.filter((p) => p.txid !== txid))
    setFeedReplies((prev) => (prev ? prev.filter((p) => p.txid !== txid) : prev))
  }, [])
  // A quote posted inline surfaces at the top of the Posts tab.
  const handleFeedQuoted = useCallback((newPost) => {
    if (newPost) setFeedPosts((prev) => [newPost, ...prev])
  }, [])

  // Stats come from the server — no loading state needed
  const totalUnlocks = typeof initialTotalUnlocks === 'number' ? initialTotalUnlocks : 0
  const walletXec = typeof initialWalletXecRaw === 'number' ? initialWalletXecRaw / 100 : 0

  useEffect(() => {
    setPosts(initialPosts)
  }, [initialPosts])

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
  // Drafts are hidden by default: every filter except "Drafts" lists published
  // articles only. Drafts surface exclusively under the "Drafts" filter.
  const publishedPosts = useMemo(
    () => nonLegacyPosts.filter((p) => p.published),
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
    // Every other filter shows published articles only — drafts stay hidden
    // until the reader picks "Drafts".
    const sourcePosts = publishedPosts
    const withCounts = sourcePosts.map((p) => ({
      ...p,
      unlocks: [{ count: unlockCountMap[p.id] ?? 0 }],
      earnings: earningsMap[p.id],
    }))
    if (sortMode === 'newest') return sortPostsByNewest(withCounts)
    if (sortMode === 'earned') return sortPostsByEarned(withCounts)
    return sortPostsByUnlocksThenNewest(withCounts)
  }, [draftPosts, earningsMap, publishedPosts, sortMode, unlockCountMap])

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

  const handleDashLogout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', cache: 'no-store' })
    } catch {
      /* ignore */
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('sessionChanged'))
      window.location.href = '/'
    }
  }, [])

  if (loadError) {
    return (
      <div className="pow-feed dash-wide">
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
    <div className="pow-feed dash-wide">
      <style>{FEED_CSS}</style>

      {/* No showLogout: on the dashboard, log out lives on the welcome card
          (top-right) at every width, not in the hamburger. */}
      <FeedTopbar signedIn isAuthor showDashboard={false} />

      <main className="wrap" style={{ paddingTop: '28px' }}>
        <div className="dashpanel">
          <div className="dashtop">
            <h1 className="dashwelcome">
              Welcome{' '}
              <Link
                href={profileHref}
                style={identity?.startsWith('@') && handleColor ? { '--hc': handleColor } : undefined}
              >
                {identity?.startsWith('@')
                  ? identity.slice(1)
                  : identity?.length <= 16
                    ? identity
                    : `${identity.slice(0, 10)}…${identity.slice(-4)}`}
              </Link>
              !
            </h1>
            {/* Log out lives in the account hub — top-right of the welcome
                card — at every width. Mobile never had a topbar hamburger; the
                dashboard's desktop hamburger no longer carries logout either, so
                the two now match. */}
            <button
              type="button"
              className="dashbtn sec dash-logout-top"
              onClick={() => void handleDashLogout()}
            >
              Log out
            </button>
          </div>

          <div className="dashstats">
            <div className="dashstat">
              <p className="dashstat-label">Total Unlocks</p>
              <p
                className="dashstat-value"
                style={{ display: 'flex', alignItems: 'center', gap: '7px' }}
              >
                <UnlockIcon size={14} />
                <span>{totalUnlocks}</span>
              </p>
            </div>
            <div className="dashstat">
              <p className="dashstat-label">Wallet Balance</p>
              <p
                className="dashstat-value"
                style={{ display: 'flex', alignItems: 'center', gap: '7px' }}
              >
                <EcashIcon size={14} />
                {walletBalanceSlot ?? (
                  <span>{walletXec.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
                )}
              </p>
            </div>
            <button
              type="button"
              className={`dashstat dashstat-btn${followsOpen === 'followers' ? ' on' : ''}`}
              aria-expanded={followsOpen === 'followers'}
              onClick={() => setFollowsOpen((cur) => (cur === 'followers' ? null : 'followers'))}
            >
              <span className="dashstat-label">Followers</span>
              <span className="dashstat-value">{followers.length.toLocaleString()}</span>
            </button>
            <button
              type="button"
              className={`dashstat dashstat-btn${followsOpen === 'following' ? ' on' : ''}`}
              aria-expanded={followsOpen === 'following'}
              onClick={() => setFollowsOpen((cur) => (cur === 'following' ? null : 'following'))}
            >
              <span className="dashstat-label">Following</span>
              <span className="dashstat-value">{following.length.toLocaleString()}</span>
            </button>
          </div>

          {followsOpen ? (
            <div className="dashfollows">
              <p className="dashfollows-title">
                {followsOpen === 'followers' ? 'Followers' : 'Following'}
              </p>
              {(followsOpen === 'followers' ? followers : following).length === 0 ? (
                <p className="dashfollows-empty">
                  {followsOpen === 'followers'
                    ? 'No followers yet — post something worth following.'
                    : 'Not following anyone yet.'}
                </p>
              ) : (
                <ul className="dashfollows-list">
                  {(followsOpen === 'followers' ? followers : following).map((a) => (
                    <li key={a.id}>
                      {a.href ? (
                        <Link
                          href={a.href}
                          className="dashfollow"
                          style={a.color ? { '--hc': a.color } : undefined}
                        >
                          {a.display}
                        </Link>
                      ) : (
                        <span className="dashfollow">{a.display}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

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

          <div className="dashactions">
            <Link href="/dashboard/new-article" className="dashbtn">
              New Article
            </Link>
            {/* Short feed posts are written on the home page, not here — this
                dashboard doesn't otherwise say so, so people land here for a
                "post" and only find the (longer, paid) article flow. Desktop
                only: mobile already has a labeled "Feed" tab in the bottom
                nav that gets you to the same compose box. */}
            <Link href="/?compose=1" className="dashbtn sec dash-desktop-only">
              New Post
            </Link>
            <Link href="/dashboard/profile" className="dashbtn sec">
              Edit Profile
            </Link>
          </div>
        </div>

        <div className="tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'posts'}
            className={`tab${tab === 'posts' ? ' on' : ''}`}
            onClick={() => setTab('posts')}
          >
            Posts
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'replies'}
            className={`tab${tab === 'replies' ? ' on' : ''}`}
            onClick={openRepliesTab}
          >
            Replies
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'articles'}
            className={`tab${tab === 'articles' ? ' on' : ''}`}
            onClick={() => setTab('articles')}
          >
            Articles
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'library'}
            className={`tab${tab === 'library' ? ' on' : ''}`}
            onClick={() => setTab('library')}
          >
            Library
          </button>
        </div>

        {tab === 'posts' ? (
          feedPosts.length === 0 ? (
            <div className="empty">
              <p>You haven’t posted to the feed yet.</p>
              <p style={{ marginTop: '16px' }}>
                <Link href="/?compose=1" className="dashbtn">
                  Write your first post
                </Link>
              </p>
            </div>
          ) : (
            <>
              <ul className="panel posts">
                {feedPosts.map((post) => (
                  <FeedPost
                    key={post.txid}
                    post={post}
                    viewerAccountId={viewerAccountId}
                    onDeleted={removeFeedItem}
                    onQuoted={handleFeedQuoted}
                  />
                ))}
              </ul>
              {feedPostsCursor ? (
                <div className="loadmore">
                  <button
                    type="button"
                    onClick={() => void loadMoreFeedPosts()}
                    disabled={feedPostsLoadingMore}
                    className="ghost"
                  >
                    {feedPostsLoadingMore ? 'Loading…' : 'Load more'}
                  </button>
                </div>
              ) : null}
            </>
          )
        ) : tab === 'replies' ? (
          feedRepliesLoading || feedReplies === null ? (
            <p className="empty">Loading replies…</p>
          ) : feedReplies.length === 0 ? (
            <p className="empty">No replies yet.</p>
          ) : (
            <>
              <ul className="panel posts">
                {feedReplies.map((post) => (
                  <FeedPost
                    key={post.txid}
                    post={post}
                    viewerAccountId={viewerAccountId}
                    onDeleted={removeFeedItem}
                    onQuoted={handleFeedQuoted}
                  />
                ))}
              </ul>
              {feedRepliesCursor ? (
                <div className="loadmore">
                  <button
                    type="button"
                    onClick={() => void loadMoreFeedReplies()}
                    disabled={feedRepliesLoadingMore}
                    className="ghost"
                  >
                    {feedRepliesLoadingMore ? 'Loading…' : 'Load more'}
                  </button>
                </div>
              ) : null}
            </>
          )
        ) : tab === 'library' ? (
          <section className="dashpanel">
            <div className="dashsection-head">
              <h2 className="dashsection-title">Your Library</h2>
              {sortedLibrary.length > 0 ? (
                <FilterDropdown
                  menuId={MENU_LIBRARY_SORT}
                  openMenu={openMenu}
                  setOpenMenu={setOpenMenu}
                  value={librarySort}
                  options={LIBRARY_SORT_OPTIONS}
                  ariaLabel="Sort library"
                  onChange={(v) => setLibrarySort(v)}
                  minWidth={SORT_PILL_MIN_WIDTH}
                />
              ) : null}
            </div>
            {sortedLibrary.length === 0 ? (
              <div className="empty">
                <p>Articles you pay to unlock live here — yours to reread anytime.</p>
                <p style={{ marginTop: '16px' }}>
                  <Link href="/" className="dashbtn">
                    Find something to read
                  </Link>
                </p>
              </div>
            ) : (
              <ul className="dashlist">
                {sortedLibrary.map((item) => (
                  <LibraryCard key={item.postId} item={item} />
                ))}
              </ul>
            )}
          </section>
        ) : (
          <>
        <section className="dashpanel">
          <div className="dashsection-head">
            <h2 className="dashsection-title">Your Articles</h2>
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
              <p>Welcome to Proof of Writing! Write articles and put them behind an eCash paywall.</p>
              <p style={{ marginTop: '16px' }}>
                <Link href="/dashboard/new-article" className="dashbtn">
                  Write your first article
                </Link>
              </p>
            </div>
          ) : (
            <>
              {sortedPosts.length === 0 ? (
                <div className="empty">
                  {sortMode === 'drafts'
                    ? 'No drafts yet.'
                    : draftPosts.length > 0
                      ? 'No published articles yet — switch the filter to “Drafts” to see your unpublished work.'
                      : 'No posts found.'}
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
          </>
        )}
      </main>
    </div>
  )
}