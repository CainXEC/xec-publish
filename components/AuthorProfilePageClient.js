'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import FeedPost from '@/components/feed/FeedPost'
import FeedNotifications from '@/components/feed/FeedNotifications'
import HandleCarousel from '@/components/HandleCarousel'
import { FEED_CSS } from '@/components/feed/feedTheme'
import ThemeToggle from '@/components/ThemeToggle'

function truncateAddress(addr) {
  const t = String(addr ?? '').trim()
  if (t.length <= 16) return t
  return `${t.slice(0, 10)}…${t.slice(-4)}`
}

/**
 * The follower count plus a "···" dropdown holding the two relationship actions
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
          aria-label="More"
        >
          ···
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
export default function AuthorProfilePageClient({
  identity,
  isAddressIdentity = false,
  bio = null,
  holderAddress = null,
  handleCards = [],
  followerCount = 0,
  totalUnlocks = 0,
  totalEarnings = 0,
  profileAccountId = null,
  viewerAccountId = null,
  initialFollowing = false,
  initialBlocked = false,
  initialPosts = [],
  identifier = '',
  articleCount = 0,
  viewerIsAuthor = false,
}) {
  const router = useRouter()
  const [posts, setPosts] = useState(initialPosts)
  const [blocked, setBlocked] = useState(Boolean(initialBlocked))
  const [copiedAddress, setCopiedAddress] = useState(false)
  const copyTimeoutRef = useRef(null)

  const removePost = useCallback((txid) => {
    setPosts((prev) => prev.filter((p) => p.txid !== txid))
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
  const earnedXec = Math.round(Number(totalEarnings || 0) / 100)

  return (
    <div className="pow-feed">
      <style>{FEED_CSS}</style>

      <div className="topbar">
        <Link href="/" className="wordmark">
          proofofwriting
        </Link>
        <div className="toplinks">
          {viewerIsAuthor ? (
            <Link href="/dashboard" className="toplink">
              dashboard
            </Link>
          ) : null}
          <Link href="/mint#marketplace" className="toplink">
            marketplace
          </Link>
          <FeedNotifications signedIn={viewerAccountId != null} />
          <ThemeToggle variant="feed" />
        </div>
      </div>

      <main className="wrap" style={{ paddingTop: '28px' }}>
        <header className="profhead">
          <h1 className={`profname${isAddressIdentity ? ' isaddr' : ''}`}>
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

          {articleCount > 0 || totalUnlocks > 0 ? (
            <div className="profstats">
              {articleCount > 0 ? (
                <Link href={`/@${encodeURIComponent(identifier)}/articles`} className="artlink">
                  📄 {articleCount.toLocaleString()}{' '}
                  {articleCount === 1 ? 'article' : 'articles'} →
                </Link>
              ) : null}
              {totalUnlocks > 0 ? (
                <span className="profstat">
                  🔓 <strong>{Number(totalUnlocks).toLocaleString()}</strong> unlocks
                </span>
              ) : null}
              {earnedXec > 0 ? (
                <span className="profstat">
                  💰 <strong>{earnedXec.toLocaleString()}</strong> XEC earned
                </span>
              ) : null}
            </div>
          ) : null}

          {bioText ? <p className="profbio">{bioText}</p> : null}
        </header>

        <HandleCarousel handles={handleCards} title="Handles" />

        <h2 className="replieshead">Posts</h2>

        {blocked ? (
          <p className="empty">You’ve blocked this account. Unblock to see their posts.</p>
        ) : posts.length === 0 ? (
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
        )}
      </main>
    </div>
  )
}
