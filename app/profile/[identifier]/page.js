import { notFound } from 'next/navigation'
import AuthorProfilePageClient from '@/components/AuthorProfilePageClient'
import { resolveProfileByIdentifier } from '@/lib/resolveProfile'
import { hydrateAuthorProfile } from '@/lib/loadAuthorProfile'
import { heldHandlesForAddress } from '@/lib/heldHandles'
import { getAccountFeedPage, getAccountRepliesPage } from '@/lib/getFeed'
import { getAuthedAccount } from '@/lib/authHelpers'
import { createServerSupabase } from '@/lib/supabase-server'
import { viewerBlocksAccount } from '@/lib/feedBlocks'
import {
  accountIdForAddress,
  followerCountForAccount,
  viewerFollowsAccount,
} from '@/lib/profileSocial'

// Reached via the next.config rewrite:  /@<identifier>  ->  /profile/<identifier>
// <identifier> is either a handle ("simon") or a bare eCash address ("qq703j…").

export async function generateMetadata({ params }) {
  const { identifier: raw } = await params
  const identifier = typeof raw === 'string' ? decodeURIComponent(raw.trim()) : ''
  const resolved = identifier ? await resolveProfileByIdentifier(identifier) : null
  const title = resolved ? `${resolved.identity} — proofofwriting` : 'Profile — proofofwriting'
  return {
    title,
    openGraph: { title, type: 'profile' },
  }
}

export default async function ProfilePage({ params }) {
  const { identifier: raw } = await params
  if (typeof raw !== 'string' || !raw.trim()) {
    notFound()
  }

  const identifier = decodeURIComponent(raw.trim())

  const resolved = await resolveProfileByIdentifier(identifier)
  if (!resolved) {
    notFound()
  }

  // Who's looking? Drives the follow button + own-post controls on the feed list.
  const viewer = await getAuthedAccount()
  const viewerAccountId = viewer?.accountId ?? null
  const viewerAddress = viewer?.address ?? ''
  const viewerIsAuthor = viewer?.authorId != null

  // A minted handle can be held by someone with no articles — or no account at
  // all. It still resolves; we just have no posts / articles to hydrate then.
  const [articleData, heldHandles, profileAccountId] = await Promise.all([
    resolved.author
      ? hydrateAuthorProfile(resolved.author)
      : Promise.resolve({ error: null, posts: [], totalUnlocks: 0, totalEarnings: 0 }),
    resolved.holderAddress
      ? heldHandlesForAddress(resolved.holderAddress)
      : Promise.resolve([]),
    resolved.holderAddress
      ? accountIdForAddress(resolved.holderAddress)
      : Promise.resolve(null),
  ])

  const [followerCount, initialFollowing, initialBlocked, feed, replies] = await Promise.all([
    followerCountForAccount(profileAccountId),
    viewerFollowsAccount(viewerAccountId, profileAccountId),
    profileAccountId
      ? viewerBlocksAccount(createServerSupabase(), viewerAccountId, profileAccountId)
      : Promise.resolve(false),
    profileAccountId
      ? getAccountFeedPage({ accountId: profileAccountId, viewerAddress, viewerAccountId })
      : Promise.resolve({ posts: [], nextCursor: null }),
    profileAccountId
      ? getAccountRepliesPage({ accountId: profileAccountId, viewerAddress, viewerAccountId })
      : Promise.resolve({ posts: [], nextCursor: null }),
  ])

  // Byline = the account's LIVE identity: "@handle" if held, else the raw address.
  const isAddressIdentity = !resolved.identity.startsWith('@')

  // The card grid shows every handle this holder owns; keep the URL's handle
  // resolvable even if Chronik couldn't enumerate it live.
  const handleCards = (heldHandles ?? []).map((h) => ({
    tokenId: h.tokenId,
    handle: h.handle,
    imageUrl: h.imageUrl,
  }))
  if (
    resolved.displayHandle &&
    !handleCards.some((h) => h.handle === resolved.displayHandle)
  ) {
    handleCards.unshift({
      tokenId: resolved.tokenId,
      handle: resolved.displayHandle,
      imageUrl: resolved.cardImageUrl,
    })
  }

  const articleCount = (articleData.posts ?? []).filter((p) => !p.legacy).length

  return (
    <AuthorProfilePageClient
      identity={resolved.identity}
      isAddressIdentity={isAddressIdentity}
      handleColor={resolved.handleColor}
      bio={resolved.author?.bio ?? null}
      holderAddress={resolved.holderAddress}
      handleCards={handleCards}
      followerCount={followerCount}
      totalUnlocks={articleData.totalUnlocks}
      totalEarnings={articleData.totalEarnings}
      profileAccountId={profileAccountId}
      viewerAccountId={viewerAccountId}
      initialFollowing={initialFollowing}
      initialBlocked={initialBlocked}
      initialPosts={feed.posts}
      initialReplies={replies.posts}
      identifier={identifier}
      articleCount={articleCount}
      postsErrorMessage={articleData.error || null}
      viewerIsAuthor={viewerIsAuthor}
    />
  )
}
