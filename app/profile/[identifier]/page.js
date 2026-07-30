import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import AuthorProfilePageClient from '@/components/AuthorProfilePageClient'
import HandleCarousel from '@/components/HandleCarousel'
import { resolveProfileByIdentifier } from '@/lib/resolveProfile'
import { heldHandlesForAddress } from '@/lib/heldHandles'
import { getCachedAccountFeedPage } from '@/lib/getFeed'
import { getCachedProfileStats } from '@/lib/profileCache'
import { getAuthedAccount } from '@/lib/authHelpers'
import { adminDb } from '@/lib/db'
import { viewerBlocksAccount } from '@/lib/feedBlocks'
import { viewerFollowsAccount } from '@/lib/profileSocial'

// Reached via the next.config rewrite:  /@<identifier>  ->  /profile/<identifier>
// <identifier> is either a handle ("simon") or a bare eCash address ("qq703j…").

export async function generateMetadata({ params }) {
  const { identifier: raw } = await params
  const identifier = typeof raw === 'string' ? decodeURIComponent(raw.trim()) : ''
  // resolveProfileByIdentifier is wrapped in React cache(): this call and the
  // page component's share one resolution per request.
  const resolved = identifier ? await resolveProfileByIdentifier(identifier) : null
  const title = resolved ? `${resolved.identity} — proofofwriting` : 'Profile — proofofwriting'
  return {
    title,
    openGraph: { title, type: 'profile' },
  }
}

/** The handle-card strip, streamed OUTSIDE the critical path: enumerating every
 *  handle a wallet holds is a Chronik call, so it renders behind Suspense and
 *  pops in when Chronik answers — the rest of the profile streams immediately.
 *  Same data + same unshift rule the page used to compute inline. */
async function ProfileHandleCards({ holderAddress, urlCard }) {
  const heldHandles = holderAddress ? await heldHandlesForAddress(holderAddress) : []
  const handleCards = (heldHandles ?? []).map((h) => ({
    tokenId: h.tokenId,
    handle: h.handle,
    imageUrl: h.imageUrl,
  }))
  // Keep the URL's handle resolvable even if Chronik couldn't enumerate it live.
  if (urlCard && !handleCards.some((h) => h.handle === urlCard.handle)) {
    handleCards.unshift(urlCard)
  }
  return <HandleCarousel handles={handleCards} title="Handles" />
}

export default async function ProfilePage({ params }) {
  const { identifier: raw } = await params
  if (typeof raw !== 'string' || !raw.trim()) {
    notFound()
  }

  const identifier = decodeURIComponent(raw.trim())

  // The two session-independent roots start together: the profile resolution
  // (deduped with generateMetadata via cache()) and the viewer's session.
  const [resolved, viewer] = await Promise.all([
    resolveProfileByIdentifier(identifier),
    getAuthedAccount(),
  ])
  if (!resolved) {
    notFound()
  }

  const viewerAccountId = viewer?.accountId ?? null
  const viewerAddress = viewer?.address ?? ''
  const viewerIsAuthor = viewer?.authorId != null

  // Social + feed queries key on the profile's account id. The resolver already
  // found it while resolving the handle/address (every account path looks it
  // up), so we read it straight off `resolved` instead of paying another
  // sequential account_addresses round trip here.
  const profileAccountId = resolved.accountId

  // Viewer-NEUTRAL data (articles + stats, and the account's own-posts feed) comes
  // from the shared per-account cache; the per-viewer bits (your follow/block
  // state, and the feed's own reaction overlay applied inside the cached call)
  // layer on top. Replies are NOT fetched here — the Replies tab loads on demand
  // via /api/feed/account-replies the first time the user switches to it.
  const [stats, feed, initialFollowing, initialBlocked] = await Promise.all([
    getCachedProfileStats({ accountId: profileAccountId, author: resolved.author }),
    profileAccountId
      ? getCachedAccountFeedPage({ accountId: profileAccountId, viewerAddress, viewerAccountId })
      : Promise.resolve({ posts: [], nextCursor: null }),
    viewerFollowsAccount(viewerAccountId, profileAccountId),
    profileAccountId
      ? viewerBlocksAccount(adminDb(), viewerAccountId, profileAccountId)
      : Promise.resolve(false),
  ])
  const articleData = stats.articleData
  const followerCount = stats.followerCount

  // Byline = the account's LIVE identity: "@handle" if held, else the raw address.
  const isAddressIdentity = !resolved.identity.startsWith('@')

  // The URL's own card renders instantly as the Suspense placeholder while the
  // full held-handles enumeration (Chronik) streams in behind it.
  const urlCard = resolved.displayHandle
    ? {
        tokenId: resolved.tokenId,
        handle: resolved.displayHandle,
        imageUrl: resolved.cardImageUrl,
      }
    : null

  return (
    <AuthorProfilePageClient
      identity={resolved.identity}
      isAddressIdentity={isAddressIdentity}
      handleColor={resolved.handleColor}
      isAi={resolved.author?.is_ai === true}
      bio={resolved.author?.bio ?? null}
      holderAddress={resolved.holderAddress}
      handleCardsSlot={
        <Suspense
          fallback={<HandleCarousel handles={urlCard ? [urlCard] : []} title="Handles" />}
        >
          <ProfileHandleCards holderAddress={resolved.holderAddress} urlCard={urlCard} />
        </Suspense>
      }
      followerCount={followerCount}
      profileAccountId={profileAccountId}
      viewerAccountId={viewerAccountId}
      initialFollowing={initialFollowing}
      initialBlocked={initialBlocked}
      initialPosts={feed.posts}
      initialPostsCursor={feed.nextCursor ?? null}
      identifier={identifier}
      initialArticles={articleData.posts ?? []}
      postsErrorMessage={articleData.error || null}
      viewerIsAuthor={viewerIsAuthor}
      authorId={resolved.author?.id ?? null}
    />
  )
}
