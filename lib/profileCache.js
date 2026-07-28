import { unstable_cache } from 'next/cache'
import { hydrateAuthorProfile } from '@/lib/loadAuthorProfile'
import { followerCountForAccount } from '@/lib/profileSocial'
import { profileCacheTag } from '@/lib/getFeed'

// =============================================================================
//  lib/profileCache.js — the viewer-NEUTRAL half of a profile page, cached.
//
//  A profile's published articles (+ all-time unlock/comment/earnings) and its
//  follower count are identical for every viewer, so they're cached across all
//  requests and shared — a popular profile collapses from a fresh
//  posts-query + 3 stat RPCs + a count per view to roughly one render per
//  window. The per-viewer bits (session, your follow/block state, your feed
//  reactions) live in the page and getCachedAccountFeedPage, never in here.
//
//  Keyed on the STABLE resolved account/author id, never the raw @handle: a
//  handle can change hands, but the account it currently resolves to can't go
//  stale under its own id. Tagged with the SAME profile:<accountId> tag as the
//  own-posts feed, so one revalidateTag freshens the whole profile.
//
//  Bio/handle/color are NOT here — the page reads those from the (uncached)
//  live resolution, so a rename/recolor still shows instantly.
// =============================================================================

const PROFILE_STATS_REVALIDATE_SECONDS = 60

const EMPTY_ARTICLES = { error: null, author: null, posts: [], totalUnlocks: 0, totalEarnings: 0 }

/** { articleData, followerCount } for a resolved profile, cached viewer-neutral.
 *  `author` may be null (a handle-only profile with no author record) — then
 *  there are no articles and the follower count rides `accountId` (0 if none). */
export async function getCachedProfileStats({ accountId, author }) {
  const account = typeof accountId === 'string' ? accountId.trim() : null
  const authorId = author?.id ?? null

  return unstable_cache(
    async () => {
      const [articleData, followerCount] = await Promise.all([
        author ? hydrateAuthorProfile(author) : Promise.resolve(EMPTY_ARTICLES),
        followerCountForAccount(account),
      ])
      return { articleData, followerCount }
    },
    ['profile-stats', account ?? 'none', authorId ?? 'none'],
    {
      tags: account ? [profileCacheTag(account)] : [],
      revalidate: PROFILE_STATS_REVALIDATE_SECONDS,
    },
  )()
}
