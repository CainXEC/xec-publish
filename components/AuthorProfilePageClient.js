'use client'

import { useCallback, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import FeedPost from '@/components/feed/FeedPost'
import HandleCarousel from '@/components/HandleCarousel'
import { FEED_CSS } from '@/components/feed/feedTheme'
import ThemeToggle from '@/components/ThemeToggle'

function truncateAddress(addr) {
  const t = String(addr ?? '').trim()
  if (t.length <= 16) return t
  return `${t.slice(0, 10)}…${t.slice(-4)}`
}

/**
 * Session-authorized follow toggle for the profile's account. Optimistic; reverts
 * if POST /api/feed/follow fails. Only rendered for a signed-in viewer looking at
 * someone else's account (the feed_follows graph is account-id keyed).
 */
function FollowButton({ followeeAccountId, initialFollowing, followerCount }) {
  const [following, setFollowing] = useState(Boolean(initialFollowing))
  const [count, setCount] = useState(Number(followerCount) || 0)
  const [busy, setBusy] = useState(false)

  const toggle = useCallback(async () => {
    if (busy) return
    const next = !following
    setBusy(true)
    setFollowing(next)
    setCount((c) => Math.max(0, c + (next ? 1 : -1)))
    try {
      const res = await fetch('/api/feed/follow', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ followeeAccountId }),
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
      setBusy(false)
    }
  }, [busy, following, followeeAccountId])

  return (
    <div className="proffollow">
      <span className="proffollowers">
        <strong>{count.toLocaleString()}</strong> {count === 1 ? 'follower' : 'followers'}
      </span>
      <button
        type="button"
        className={`followbtn${following ? ' on' : ''}`}
        onClick={toggle}
        disabled={busy}
        aria-pressed={following}
      >
        {following ? 'Following' : 'Follow'}
      </button>
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
  initialPosts = [],
  identifier = '',
  articleCount = 0,
  viewerIsAuthor = false,
}) {
  const router = useRouter()
  const [posts, setPosts] = useState(initialPosts)
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
  const canFollow =
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

          {canFollow ? (
            <FollowButton
              followeeAccountId={profileAccountId}
              initialFollowing={initialFollowing}
              followerCount={followerCount}
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

        {posts.length === 0 ? (
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
