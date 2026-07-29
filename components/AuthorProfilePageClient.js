'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import ActivityRail from '@/components/feed/ActivityRail'
import AuthorFrontPage from '@/components/feed/AuthorFrontPage'
import HomeReader from '@/components/feed/HomeReader'
import FeedPost from '@/components/feed/FeedPost'
import FeedTopbar from '@/components/feed/FeedTopbar'
import HandleCarousel from '@/components/HandleCarousel'
import { FEED_CSS } from '@/components/feed/feedTheme'
import { formatReadingTimeLabel } from '@/lib/getReadingTime'

function truncateAddress(addr) {
  const t = String(addr ?? '').trim()
  if (t.length <= 16) return t
  return `${t.slice(0, 10)}…${t.slice(-4)}`
}

// Append a fetched page onto an existing list, dropping any txid already shown
// (keyset paging shouldn't overlap, but a post added between pages could).
function appendUnique(prev, more) {
  const seen = new Set((prev ?? []).map((p) => p.txid))
  return [...(prev ?? []), ...more.filter((p) => p.txid && !seen.has(p.txid))]
}

/**
 * The follower count plus a "+" dropdown holding the two relationship actions
 * for the profile's account: Follow/Unfollow and Block/Unblock. Session-authorized
 * and optimistic. Follow updates the follower count in place. Blocking hides both
 * accounts' posts from each other, stops the blocked party replying, and
 * auto-unfollows on the server — so we refresh afterward to reconcile the count
 * and post list, and surface the blocked state to the parent via onBlockedChange.
 * Only rendered for a signed-in viewer looking at someone else's account.
 */
function ProfileActionsMenu({
  accountId,
  initialFollowing,
  initialBlocked,
  followerCount,
  onBlockedChange,
}) {
  const [open, setOpen] = useState(false)
  const [following, setFollowing] = useState(Boolean(initialFollowing))
  const [blocked, setBlocked] = useState(Boolean(initialBlocked))
  const [count, setCount] = useState(Number(followerCount) || 0)
  const [busyFollow, setBusyFollow] = useState(false)
  const [busyBlock, setBusyBlock] = useState(false)
  const rootRef = useRef(null)
  const router = useRouter()

  useEffect(() => {
    if (!open) return
    const onDocClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  const toggleFollow = useCallback(async () => {
    if (busyFollow) return
    const next = !following
    setBusyFollow(true)
    setFollowing(next)
    setCount((c) => Math.max(0, c + (next ? 1 : -1)))
    try {
      const res = await fetch('/api/feed/follow', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ followeeAccountId: accountId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) {
        setFollowing(!next)
        setCount((c) => Math.max(0, c + (next ? -1 : 1)))
      } else if (typeof data.following === 'boolean' && data.following !== next) {
        setFollowing(data.following)
        setCount((c) => Math.max(0, c + (data.following ? 1 : -1)))
      }
    } catch {
      setFollowing(!next)
      setCount((c) => Math.max(0, c + (next ? -1 : 1)))
    } finally {
      setBusyFollow(false)
    }
  }, [busyFollow, following, accountId])

  const toggleBlock = useCallback(async () => {
    if (busyBlock) return
    const next = !blocked
    if (next && !window.confirm("Block this account? You won't see each other's posts, and they can't reply to you.")) {
      return
    }
    setBusyBlock(true)
    setBlocked(next) // optimistic
    onBlockedChange?.(next)
    // Blocking auto-unfollows server-side; mirror that locally so the count/label
    // don't lie until the refresh lands.
    if (next && following) {
      setFollowing(false)
      setCount((c) => Math.max(0, c - 1))
    }
    try {
      const res = await fetch('/api/feed/block', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ blockedAccountId: accountId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) {
        setBlocked(!next) // revert
        onBlockedChange?.(!next)
        window.alert(data.error || 'Failed to update block')
      } else {
        if (typeof data.blocked === 'boolean' && data.blocked !== next) {
          setBlocked(data.blocked)
          onBlockedChange?.(data.blocked)
        }
        setOpen(false)
        router.refresh() // reconcile follower count + posts with the new state
      }
    } catch {
      setBlocked(!next)
      onBlockedChange?.(!next)
    } finally {
      setBusyBlock(false)
    }
  }, [busyBlock, blocked, following, accountId, onBlockedChange, router])

  return (
    <div className="proffollow">
      <span className="proffollowers">
        <strong>{count.toLocaleString()}</strong> {count === 1 ? 'follower' : 'followers'}
      </span>
      <span className="postmenu" ref={rootRef}>
        <button
          type="button"
          className={`menubtn${following ? ' following' : ''}`}
          onClick={() => setOpen((s) => !s)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={following ? 'Following — manage' : 'Follow or block'}
          title={following ? 'Following' : 'Follow or block'}
        >
          {following ? '✓' : '+'}
        </button>
        {open ? (
          <div className="menupop" role="menu">
            {/* While blocked, follow is moot (the block severs it) — only Unblock. */}
            {!blocked ? (
              <button
                type="button"
                role="menuitem"
                className="menuitem"
                onClick={toggleFollow}
                disabled={busyFollow}
              >
                {busyFollow ? '…' : following ? 'Unfollow' : 'Follow'}
              </button>
            ) : null}
            <button
              type="button"
              role="menuitem"
              className="menuitem danger"
              onClick={toggleBlock}
              disabled={busyBlock}
            >
              {busyBlock ? '…' : blocked ? 'Unblock' : 'Block'}
            </button>
          </div>
        ) : null}
      </span>
    </div>
  )
}

/**
 * A public profile, in the cypherpunk-neon feed theme. Centered on whoever holds
 * the handle: the @identity, every handle NFT they own (voxel cards), a follower
 * indicator (+ session follow), an optional link to their articles, and their
 * feed posts below — Twitter-style. `profileAccountId` is null for a handle held
 * by someone with no proofofwriting account (no posts, no follow).
 */
// ---- Articles tab: one article row (mirrors app/profile/[identifier]/articles) ----
function formatArticleXec(amount) {
  const n = Number(amount)
  if (!Number.isFinite(n)) return '0'
  return n.toFixed(8).replace(/\.?0+$/, '')
}
function formatArticleDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}
function articleUnlockCount(post) {
  const row = Array.isArray(post.unlocks) ? post.unlocks[0] : post.unlocks
  const n = Number(row?.count)
  return Number.isFinite(n) ? n : 0
}
function articlePriceLabel(priceXec) {
  const n = Number(priceXec)
  if (!Number.isFinite(n) || n <= 0) return 'Free'
  return `${formatArticleXec(priceXec)} XEC`
}
function ArticleRow({ post, onOpen }) {
  const href = post.legacy
    ? `/${encodeURIComponent(post.slug)}`
    : `/posts/${encodeURIComponent(post.slug)}`
  const unlocks = articleUnlockCount(post)
  const readTime = formatReadingTimeLabel(post.reading_time_minutes)
  const date = formatArticleDate(post.published_at ?? post.created_at)
  // Open the story in the center reading pane (the reader route resolves legacy
  // and current posts alike). Modifier clicks (new tab etc.) fall through to the
  // real permalink in `href`, same as the front page and the left "pages" rail.
  const open = onOpen
    ? (e) => {
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1) return
        e.preventDefault()
        onOpen(post.slug)
      }
    : undefined
  return (
    <li className="artrow">
      <Link
        href={href}
        className="artrow-title"
        onClick={open}
        data-no-navprogress={open ? '' : undefined}
      >
        {post.title || 'Untitled'}
      </Link>
      <div className="artrow-meta">
        {date ? <span>{date}</span> : null}
        <span className="artrow-sep" aria-hidden>·</span>
        <span>{articlePriceLabel(post.price_xec)}</span>
        <span className="artrow-sep" aria-hidden>·</span>
        <span>🔓 {unlocks.toLocaleString()} {unlocks === 1 ? 'unlock' : 'unlocks'}</span>
        {readTime ? (
          <>
            <span className="artrow-sep" aria-hidden>·</span>
            <span>{readTime}</span>
          </>
        ) : null}
      </div>
      {post.teaser ? <p className="artrow-teaser">{post.teaser}</p> : null}
    </li>
  )
}

export default function AuthorProfilePageClient({
  identity,
  isAddressIdentity = false,
  handleColor = null,
  isAi = false,
  bio = null,
  holderAddress = null,
  handleCards = [],
  handleCardsSlot = null,
  followerCount = 0,
  profileAccountId = null,
  viewerAccountId = null,
  initialFollowing = false,
  initialBlocked = false,
  initialPosts = [],
  initialPostsCursor = null,
  initialReplies = null,
  identifier = '',
  initialArticles = [],
  viewerIsAuthor = false,
  authorId = null,
}) {
  const router = useRouter()
  const [tab, setTab] = useState('posts') // 'posts' | 'replies' | 'articles'
  // The reading pane, same pattern as the home feed: pure client state (no
  // history games — the router fights the scroll restore), profile stays
  // MOUNTED underneath so tabs/scroll survive the detour.
  const [readerSlug, setReaderSlug] = useState(null)
  const profScrollRef = useRef(0)

  const openStory = useCallback((slug) => {
    if (!slug) return
    profScrollRef.current = window.scrollY
    setReaderSlug(slug)
    window.scrollTo(0, 0)
  }, [])

  const closeReader = useCallback(() => {
    setReaderSlug(null)
    const y = profScrollRef.current
    requestAnimationFrame(() => window.scrollTo(0, y))
    setTimeout(() => window.scrollTo(0, y), 200)
  }, [])

  // While reading, the banner means "back to this profile" — catch it before
  // the topbar's Link navigates home.
  useEffect(() => {
    if (!readerSlug) return
    const onCapture = (e) => {
      if (e.target.closest?.('.wordmark')) {
        e.preventDefault()
        e.stopPropagation()
        closeReader()
      }
    }
    document.addEventListener('click', onCapture, true)
    return () => document.removeEventListener('click', onCapture, true)
  }, [readerSlug, closeReader])

  const [posts, setPosts] = useState(initialPosts)
  // Cursor for the Posts tab: the server renders page 1 and hands us the cursor
  // for page 2; null means no more pages. Infinite scroll walks it forward.
  const [postsCursor, setPostsCursor] = useState(initialPostsCursor)
  const [postsLoadingMore, setPostsLoadingMore] = useState(false)
  // Replies load ON DEMAND: null = not fetched yet. The server no longer renders
  // them into every profile visit; the first switch to the Replies tab fetches
  // them from /api/feed/account-replies (same shape as before).
  const [replies, setReplies] = useState(initialReplies)
  const [repliesLoading, setRepliesLoading] = useState(false)
  const [repliesCursor, setRepliesCursor] = useState(null)
  const [repliesLoadingMore, setRepliesLoadingMore] = useState(false)
  const articleList = (initialArticles ?? []).filter((p) => !p.legacy)
  const legacyList = (initialArticles ?? []).filter((p) => p.legacy)
  const [blocked, setBlocked] = useState(Boolean(initialBlocked))
  const [copiedAddress, setCopiedAddress] = useState(false)
  const copyTimeoutRef = useRef(null)

  const loadReplies = useCallback(async () => {
    if (!profileAccountId) { setReplies((prev) => prev ?? []); return }
    setRepliesLoading(true)
    try {
      const res = await fetch(
        `/api/feed/account-replies?accountId=${encodeURIComponent(profileAccountId)}`,
      )
      const data = await res.json()
      setReplies(Array.isArray(data.posts) ? data.posts : [])
      setRepliesCursor(data.nextCursor ?? null)
    } catch {
      setReplies([])
    } finally {
      setRepliesLoading(false)
    }
  }, [profileAccountId])

  const openRepliesTab = useCallback(() => {
    setTab('replies')
    if (replies === null && !repliesLoading) void loadReplies()
  }, [replies, repliesLoading, loadReplies])

  const loadMorePosts = useCallback(async () => {
    if (postsLoadingMore || !postsCursor || !profileAccountId) return
    setPostsLoadingMore(true)
    try {
      const res = await fetch(
        `/api/feed/account-posts?accountId=${encodeURIComponent(profileAccountId)}&cursor=${encodeURIComponent(postsCursor)}`,
      )
      const data = await res.json()
      if (res.ok && Array.isArray(data.posts)) {
        setPosts((prev) => appendUnique(prev, data.posts))
        setPostsCursor(data.nextCursor ?? null)
      }
    } catch {
      /* leave the cursor in place — scrolling again retries */
    } finally {
      setPostsLoadingMore(false)
    }
  }, [postsLoadingMore, postsCursor, profileAccountId])

  const loadMoreReplies = useCallback(async () => {
    if (repliesLoadingMore || !repliesCursor || !profileAccountId) return
    setRepliesLoadingMore(true)
    try {
      const res = await fetch(
        `/api/feed/account-replies?accountId=${encodeURIComponent(profileAccountId)}&cursor=${encodeURIComponent(repliesCursor)}`,
      )
      const data = await res.json()
      if (res.ok && Array.isArray(data.posts)) {
        setReplies((prev) => appendUnique(prev, data.posts))
        setRepliesCursor(data.nextCursor ?? null)
      }
    } catch {
      /* leave the cursor in place — scrolling again retries */
    } finally {
      setRepliesLoadingMore(false)
    }
  }, [repliesLoadingMore, repliesCursor, profileAccountId])

  // One IntersectionObserver drives infinite scroll for whichever tab is active.
  // The load-more call lives behind a ref so the observer never needs to be torn
  // down and rebuilt as cursors/loading flags change — it just fires on sight.
  const loadMoreRef = useRef(() => {})
  loadMoreRef.current = () => {
    if (tab === 'posts') void loadMorePosts()
    else if (tab === 'replies') void loadMoreReplies()
  }
  const sentinelRef = useRef(null)
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMoreRef.current()
      },
      { rootMargin: '600px' },
    )
    obs.observe(el)
    return () => obs.disconnect()
    // Re-attach when the active tab changes, when a sentinel mounts/unmounts
    // (cursor flips to/from null), or when the reader pane hides the list.
  }, [tab, postsCursor, repliesCursor, readerSlug])

  // A delete/block can target a post in either list, so filter both.
  const removePost = useCallback((txid) => {
    setPosts((prev) => prev.filter((p) => p.txid !== txid))
    setReplies((prev) => (prev ? prev.filter((p) => p.txid !== txid) : prev))
  }, [])

  const copyAddress = useCallback(async () => {
    const trimmed = typeof holderAddress === 'string' ? holderAddress.trim() : ''
    if (!trimmed) return
    try {
      await navigator.clipboard.writeText(trimmed)
      setCopiedAddress(true)
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current)
      copyTimeoutRef.current = setTimeout(() => setCopiedAddress(false), 2000)
    } catch {
      /* clipboard unavailable — nothing to do */
    }
  }, [holderAddress])

  const handleQuoted = useCallback(
    (quote) => {
      if (quote?.txid) router.push(`/feed/${quote.txid}`)
    },
    [router],
  )

  const bioText = bio != null && String(bio).trim() !== '' ? String(bio).trim() : ''
  const canManageAuthor =
    !!profileAccountId && !!viewerAccountId && viewerAccountId !== profileAccountId

  return (
    <div className="pow-feed has-rail">
      <style>{FEED_CSS}</style>

      <FeedTopbar signedIn={viewerAccountId != null} isAuthor={viewerIsAuthor} />

      {/* The author's spread: their own paper + handles on the left (≥1280px),
          their live economy on the right (≥1100px). Same grid the home feed
          uses; phones render the untouched single column. */}
      <div className="feed-cols">
      <aside className="feed-left" aria-label="This author's front page">
        <AuthorFrontPage identity={identity} stories={initialArticles} onOpenStory={openStory} />
        {handleCardsSlot ? (
          <div className="prof-handles-rail">
            {handleCardsSlot}
            <Link
              className="prof-offerlink"
              href={
                !isAddressIdentity
                  ? `/marketplace?view=all&q=${encodeURIComponent(String(identity).replace(/^@/, ''))}`
                  : '/marketplace?view=all'
              }
            >
              Make an offer on a handle →
            </Link>
          </div>
        ) : null}
      </aside>
      <main className="wrap" style={{ paddingTop: '28px' }}>
        {readerSlug ? (
          <HomeReader slug={readerSlug} onClose={closeReader} backLabel="← The profile" />
        ) : null}
        <div style={readerSlug ? { display: 'none' } : undefined}>
        <header className="profhead">
          <h1
            className={`profname${isAddressIdentity ? ' isaddr' : ''}`}
            style={!isAddressIdentity && handleColor ? { '--hc': handleColor } : undefined}
          >
            {isAddressIdentity ? identity : String(identity ?? '').replace(/^@/, '')}
            {isAi ? (
              <span className="aibadge" title="AI-operated account">
                [AI]
              </span>
            ) : null}
          </h1>

          {holderAddress ? (
            <>
              <button
                type="button"
                className="profaddr"
                onClick={() => void copyAddress()}
                title="Click to copy"
              >
                {truncateAddress(holderAddress)}
              </button>
              {copiedAddress ? <span className="profcopied">Copied!</span> : null}
            </>
          ) : null}

          {canManageAuthor ? (
            <ProfileActionsMenu
              accountId={profileAccountId}
              initialFollowing={initialFollowing}
              initialBlocked={initialBlocked}
              followerCount={followerCount}
              onBlockedChange={setBlocked}
            />
          ) : (
            <span className="proffollowers standalone">
              <strong>{Number(followerCount).toLocaleString()}</strong>{' '}
              {Number(followerCount) === 1 ? 'follower' : 'followers'}
            </span>
          )}

          {bioText ? <p className="profbio">{bioText}</p> : null}
        </header>

        <div className="prof-handles-center">
          {handleCardsSlot ?? <HandleCarousel handles={handleCards} title="Handles" />}
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
        </div>

        {blocked ? (
          <p className="empty">You’ve blocked this account. Unblock to see their posts.</p>
        ) : tab === 'posts' ? (
          posts.length === 0 ? (
            <p className="empty">No posts yet.</p>
          ) : (
            <>
              <ul className="panel posts">
                {posts.map((post) => (
                  <FeedPost
                    key={post.txid}
                    post={post}
                    viewerAccountId={viewerAccountId}
                    onDeleted={removePost}
                    onQuoted={handleQuoted}
                  />
                ))}
              </ul>
              {postsCursor ? (
                <div ref={sentinelRef} className="loadmore">
                  {postsLoadingMore ? (
                    <p className="empty">Loading more…</p>
                  ) : (
                    // A real button (not an empty div): it gives the sentinel a
                    // non-zero height so the IntersectionObserver auto-loads, AND
                    // it's a guaranteed manual fallback if the observer doesn't fire.
                    <button type="button" className="ghost" onClick={() => void loadMorePosts()}>
                      Load more
                    </button>
                  )}
                </div>
              ) : null}
            </>
          )
        ) : tab === 'replies' ? (
          repliesLoading || replies === null ? (
            <p className="empty">Loading replies…</p>
          ) : replies.length === 0 ? (
            <p className="empty">No replies yet.</p>
          ) : (
            <>
              <ul className="panel posts">
                {replies.map((post) => (
                  <FeedPost
                    key={post.txid}
                    post={post}
                    viewerAccountId={viewerAccountId}
                    onDeleted={removePost}
                    onQuoted={handleQuoted}
                  />
                ))}
              </ul>
              {repliesCursor ? (
                <div ref={sentinelRef} className="loadmore">
                  {repliesLoadingMore ? (
                    <p className="empty">Loading more…</p>
                  ) : (
                    <button type="button" className="ghost" onClick={() => void loadMoreReplies()}>
                      Load more
                    </button>
                  )}
                </div>
              ) : null}
            </>
          )
        ) : articleList.length === 0 && legacyList.length === 0 ? (
          <p className="empty">No articles published yet.</p>
        ) : (
          <>
            {articleList.length > 0 ? (
              <ul className="panel artlist">
                {articleList.map((post) => (
                  <ArticleRow key={post.id} post={post} onOpen={openStory} />
                ))}
              </ul>
            ) : null}
            {legacyList.length > 0 ? (
              <details className="artlegacy">
                <summary>Legacy posts ({legacyList.length})</summary>
                <ul className="panel artlist">
                  {legacyList.map((post) => (
                    <ArticleRow key={post.id} post={post} onOpen={openStory} />
                  ))}
                </ul>
              </details>
            ) : null}
          </>
        )}
        </div>
      </main>

      <aside className="feed-rail" aria-label="This author's on-chain activity">
        <ActivityRail
          heading={!isAddressIdentity ? `${identity}'s economy` : "This author's economy"}
          sub="Unlocks, tips and posts touching this author — every line is an on-chain transaction."
          emptyText="Quiet so far — this author's first sale lands here."
          scope={{ authorId, address: holderAddress }}
        />
      </aside>
      </div>
    </div>
  )
}
