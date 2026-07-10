'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
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
          className="menubtn"
          onClick={() => setOpen((s) => !s)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Follow or block"
        >
          +
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
function ArticleRow({ post }) {
  const href = post.legacy
    ? `/${encodeURIComponent(post.slug)}`
    : `/posts/${encodeURIComponent(post.slug)}`
  const unlocks = articleUnlockCount(post)
  const readTime = formatReadingTimeLabel(post.reading_time_minutes)
  const date = formatArticleDate(post.published_at ?? post.created_at)
  return (
    <li className="artrow">
      <Link href={href} className="artrow-title">
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
  bio = null,
  holderAddress = null,
  handleCards = [],
  followerCount = 0,
  profileAccountId = null,
  viewerAccountId = null,
  initialFollowing = false,
  initialBlocked = false,
  initialPosts = [],
  initialReplies = [],
  identifier = '',
  initialArticles = [],
  viewerIsAuthor = false,
}) {
  const router = useRouter()
  const [tab, setTab] = useState('posts') // 'posts' | 'replies' | 'articles'
  const [posts, setPosts] = useState(initialPosts)
  const [replies, setReplies] = useState(initialReplies)
  const articleList = (initialArticles ?? []).filter((p) => !p.legacy)
  const legacyList = (initialArticles ?? []).filter((p) => p.legacy)
  const [blocked, setBlocked] = useState(Boolean(initialBlocked))
  const [copiedAddress, setCopiedAddress] = useState(false)
  const copyTimeoutRef = useRef(null)

  // A delete/block can target a post in either list, so filter both.
  const removePost = useCallback((txid) => {
    setPosts((prev) => prev.filter((p) => p.txid !== txid))
    setReplies((prev) => prev.filter((p) => p.txid !== txid))
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
    <div className="pow-feed">
      <style>{FEED_CSS}</style>

      <FeedTopbar signedIn={viewerAccountId != null} isAuthor={viewerIsAuthor} />

      <main className="wrap" style={{ paddingTop: '28px' }}>
        <header className="profhead">
          <h1
            className={`profname${isAddressIdentity ? ' isaddr' : ''}`}
            style={!isAddressIdentity && handleColor ? { '--hc': handleColor } : undefined}
          >
            {isAddressIdentity ? identity : String(identity ?? '').replace(/^@/, '')}
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

        <HandleCarousel handles={handleCards} title="Handles" />

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
            onClick={() => setTab('replies')}
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
          )
        ) : tab === 'replies' ? (
          replies.length === 0 ? (
            <p className="empty">No replies yet.</p>
          ) : (
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
          )
        ) : articleList.length === 0 && legacyList.length === 0 ? (
          <p className="empty">No articles published yet.</p>
        ) : (
          <>
            {articleList.length > 0 ? (
              <ul className="panel artlist">
                {articleList.map((post) => (
                  <ArticleRow key={post.id} post={post} />
                ))}
              </ul>
            ) : null}
            {legacyList.length > 0 ? (
              <details className="artlegacy">
                <summary>Legacy posts ({legacyList.length})</summary>
                <ul className="panel artlist">
                  {legacyList.map((post) => (
                    <ArticleRow key={post.id} post={post} />
                  ))}
                </ul>
              </details>
            ) : null}
          </>
        )}
      </main>
    </div>
  )
}
