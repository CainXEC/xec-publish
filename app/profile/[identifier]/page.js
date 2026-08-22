import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import AuthorProfilePageClient from '@/components/AuthorProfilePageClient'
import HandleCarousel from '@/components/HandleCarousel'
import { resolveProfileByIdentifier } from '@/lib/resolveProfile'
import { cachedHeldHandlesForDisplay } from '@/lib/heldHandles'
import { getCachedAccountFeedPage } from '@/lib/getFeed'
import { getCachedArticleData } from '@/lib/profileCache'
import { getAuthedAccount } from '@/lib/authHelpers'
import { adminDb } from '@/lib/db'
import { viewerBlocksAccount } from '@/lib/feedBlocks'
import { viewerFollowsAccount, followerCountForAccount } from '@/lib/profileSocial'
import { profileOpenGraphMetadata } from '@/lib/profileOgMetadata'

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.proofofwriting.com'

// Reached via the next.config rewrite:  /@<identifier>  ->  /profile/<identifier>
// <identifier> is either a handle ("simon") or a bare eCash address ("qq703j…").

// Clicking a handle card opens that NFT's page in Cashtab (same deep-link the
// marketplace uses to buy), where the holder lists it for sale — turning "go to
// Cashtab and find it yourself" into one click. Listing must be signed by the
// wallet that holds the NFT, which lives in Cashtab, so the handoff happens there.
const CASHTAB_TOKEN_BASE = 'https://cashtab.com/#/token/'

export async function generateMetadata({ params }) {
  const { identifier: raw } = await params
  const identifier = typeof raw === 'string' ? decodeURIComponent(raw.trim()) : ''
  // resolveProfileByIdentifier is wrapped in React cache(): this call and the
  // page component's share one resolution per request.
  const resolved = identifier ? await resolveProfileByIdentifier(identifier) : null
  if (!resolved) {
    return {
      title: 'Profile — proofofwriting',
      openGraph: { title: 'Profile — proofofwriting', type: 'profile' },
    }
  }

  const followers = await followerCountForAccount(resolved.accountId)
  return profileOpenGraphMetadata({
    identity: resolved.identity,
    color: resolved.handleColor,
    bio: resolved.author?.bio ?? '',
    followers,
    pageUrl: `${siteUrl}/@${encodeURIComponent(identifier)}`,
  })
}

/** The handle-card strip, streamed OUTSIDE the critical path: enumerating every
 *  handle a wallet holds is a Chronik call, so it renders behind Suspense and
 *  pops in when Chronik answers — the rest of the profile streams immediately.
 *  Same data + same unshift rule the page used to compute inline. */
async function ProfileHandleCards({ holderAddress, urlCard }) {
  const heldHandles = holderAddress ? await cachedHeldHandlesForDisplay(holderAddress) : []
  const handleCards = (heldHandles ?? []).map((h) => ({
    tokenId: h.tokenId,
    handle: h.handle,
    imageUrl: h.imageUrl,
  }))
  // Keep the URL's handle resolvable even if Chronik couldn't enumerate it live.
  if (urlCard && !handleCards.some((h) => h.handle === urlCard.handle)) {
    handleCards.unshift(urlCard)
  }
  return <HandleCarousel handles={handleCards} title="Handles" cardHrefBase={CASHTAB_TOKEN_BASE} />
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

  // The account's own-posts feed + the cheap per-viewer bits (follow/block) and
  // the follower COUNT stay on the critical path — all fast. The one expensive
  // thing, the article data (a big posts query + 3 aggregate RPCs over the whole
  // unlock/comment/earnings history, scaling with article count), is NOT awaited
  // here: its promise is handed to the client, which streams the article sections
  // in behind Suspense so a prolific author's shell + feed still render at once.
  // Replies are NOT fetched here either — the Replies tab loads on demand via
  // /api/feed/account-replies the first time the user switches to it.
  const articlesPromise = getCachedArticleData({
    accountId: profileAccountId,
    author: resolved.author,
  })
  const [followerCount, feed, initialFollowing, initialBlocked] = await Promise.all([
    followerCountForAccount(profileAccountId),
    profileAccountId
      ? getCachedAccountFeedPage({ accountId: profileAccountId, viewerAddress, viewerAccountId })
      : Promise.resolve({ posts: [], nextCursor: null }),
    viewerFollowsAccount(viewerAccountId, profileAccountId),
    profileAccountId
      ? viewerBlocksAccount(adminDb(), viewerAccountId, profileAccountId)
      : Promise.resolve(false),
  ])

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
          fallback={
            <HandleCarousel
              handles={urlCard ? [urlCard] : []}
              title="Handles"
              cardHrefBase={CASHTAB_TOKEN_BASE}
            />
          }
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
      articlesPromise={articlesPromise}
      viewerIsAuthor={viewerIsAuthor}
      authorId={resolved.author?.id ?? null}
    />
  )
}
