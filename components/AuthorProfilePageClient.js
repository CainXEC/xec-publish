'use client'

import { useCallback, useEffect, useState } from 'react'
import Nav from '@/components/Nav'
import AuthorProfilePosts from '@/components/AuthorProfilePosts'
import CopyableAddress from '@/components/CopyableAddress'

/**
 * @param {{
 *   author: { id: string, username: string, xec_address?: string | null, bio?: string | null } | null
 *   initialPosts: unknown[]
 *   totalUnlocks: number
 *   totalEarnings: number
 *   postsErrorMessage: string | null
 *   displayName?: string        // live byline: "@handle" or a raw address. Falls back to @username.
 *   isAddressIdentity?: boolean  // true when displayName is a raw address (style + de-dupe address line)
 *   holderAddress?: string | null  // on-chain holder — shown when there's no author record
 *   cardImageUrl?: string | null   // handle NFT card — shown on handle-only profiles
 * }} props
 *
 * `author` is null for a handle held by someone with no articles / no account:
 * a handle-only profile that shows just the handle, its card, and holder address.
 */
export default function AuthorProfilePageClient({
  author,
  initialPosts,
  totalUnlocks = 0,
  totalEarnings = 0,
  postsErrorMessage,
  displayName,
  isAddressIdentity = false,
  holderAddress = null,
  cardImageUrl = null,
}) {
  const [readerWalletAddress, setReaderWalletAddress] = useState('')
  const [isFollowing, setIsFollowing] = useState(false)
  const [followerCount, setFollowerCount] = useState(0)
  const [followLoading, setFollowLoading] = useState(false)

  const applyReaderWallet = useCallback(async (walletAddress) => {
    setReaderWalletAddress(walletAddress)
    localStorage.setItem('readerWalletAddress', walletAddress)
  }, [])

  const handleReaderLogoutExtra = useCallback(() => {
    setReaderWalletAddress('')
    setIsFollowing(false)
  }, [])

  useEffect(() => {
    if (!author?.id) return
    fetch(`/api/follows/count?authorId=${encodeURIComponent(author.id)}`)
      .then((r) => r.json())
      .then((data) => {
        setFollowerCount(data.followerCount ?? 0)
      })
      .catch(() => {})
  }, [author?.id])

  useEffect(() => {
    if (!readerWalletAddress || !author?.id) return
    fetch(
      `/api/follows?walletAddress=${encodeURIComponent(readerWalletAddress)}&authorId=${encodeURIComponent(author.id)}`,
    )
      .then((r) => r.json())
      .then((data) => {
        setIsFollowing(data.following ?? false)
        setFollowerCount(data.followerCount ?? 0)
      })
      .catch(() => {})
  }, [readerWalletAddress, author?.id])

  const handleFollow = async () => {
    if (!readerWalletAddress || followLoading || !author?.id) return
    setFollowLoading(true)
    try {
      const res = await fetch('/api/follows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress: readerWalletAddress,
          authorId: author.id,
        }),
      })
      const data = await res.json()
      setIsFollowing(data.following ?? false)
      setFollowerCount(data.followerCount ?? 0)
    } catch {
      /* ignore */
    } finally {
      setFollowLoading(false)
    }
  }

  const bioText =
    author?.bio != null && String(author.bio).trim() !== ''
      ? String(author.bio).trim()
      : ''

  // Live identity byline. Defaults to the legacy "@username" when no displayName
  // is supplied (so the /u/ path and any other caller behave exactly as before).
  const headingText =
    displayName != null && String(displayName).trim() !== ''
      ? String(displayName)
      : author?.username
        ? `@${author.username}`
        : ''

  return (
    <div className="min-h-full flex-1 bg-zinc-50 dark:bg-zinc-950">
      <Nav
        onReaderWalletSynced={applyReaderWallet}
        onReaderLogoutExtra={handleReaderLogoutExtra}
      />
      <main className="mx-auto max-w-5xl px-4 pt-4 pb-6 sm:px-6 sm:pt-6 sm:pb-6">
        <header className="border-b border-zinc-200 pb-4 dark:border-zinc-800">
          <p className="text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            {author ? 'Author' : 'Handle'}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 sm:gap-3">
            <h1
              className={
                isAddressIdentity
                  ? 'min-w-0 break-all font-mono text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-2xl'
                  : 'min-w-0 text-4xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-5xl'
              }
            >
              {headingText}
            </h1>
            {readerWalletAddress ? (
              <button
                type="button"
                title={isFollowing ? undefined : 'Follow'}
                aria-label={isFollowing ? 'Following author' : 'Follow author'}
                onClick={() => void handleFollow()}
                disabled={followLoading}
                className={
                  followLoading
                    ? 'shrink-0 cursor-not-allowed rounded-full border border-zinc-200 bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-500'
                    : isFollowing
                      ? 'inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-500 dark:bg-emerald-500 dark:text-emerald-950 dark:hover:bg-emerald-400'
                      : 'shrink-0 rounded-full border border-zinc-300 bg-white px-2 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800'
                }
              >
                {followLoading ? (
                  '…'
                ) : isFollowing ? (
                  <>
                    <span aria-hidden>✓</span> Following
                  </>
                ) : (
                  <span aria-hidden className="tabular-nums">
                    +
                  </span>
                )}
              </button>
            ) : null}
          </div>
          {author?.xec_address && !isAddressIdentity ? (
            <CopyableAddress address={author.xec_address} />
          ) : !author && holderAddress ? (
            <CopyableAddress address={holderAddress} />
          ) : null}
          {author ? (
            <>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  {followerCount} {followerCount === 1 ? 'follower' : 'followers'}
                </p>
              </div>
              <div className="mt-4 flex gap-6 text-sm text-zinc-600 dark:text-zinc-400">
                <span>
                  🔓{' '}
                  <strong className="text-zinc-900 dark:text-zinc-50">
                    {Number(totalUnlocks).toLocaleString('en-US')}
                  </strong>{' '}
                  unlocks
                </span>
                <span>
                  💰{' '}
                  <strong className="text-zinc-900 dark:text-zinc-50">
                    {Math.round(Number(totalEarnings) / 100).toLocaleString('en-US')}
                  </strong>{' '}
                  XEC earned
                </span>
              </div>
            </>
          ) : null}
          {bioText ? (
            <p className="mt-6 max-w-2xl whitespace-pre-wrap text-base leading-relaxed text-zinc-600 dark:text-zinc-400">
              {bioText}
            </p>
          ) : null}
          {!author && cardImageUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={cardImageUrl}
              alt={`${headingText} handle card`}
              className="mt-6 w-full max-w-xs rounded-xl border border-zinc-200 dark:border-zinc-800"
            />
          ) : null}
          {!author ? (
            <p className="mt-6 max-w-2xl text-base leading-relaxed text-zinc-500 dark:text-zinc-400">
              This handle hasn’t published any articles or posts yet.
            </p>
          ) : null}
        </header>

        {author ? (
          <AuthorProfilePosts initialPosts={initialPosts} postsErrorMessage={postsErrorMessage} />
        ) : null}
      </main>
    </div>
  )
}
