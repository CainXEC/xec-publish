import { unstable_cache } from 'next/cache'
import { loadProfileArticles } from '@/lib/loadAuthorProfile'
import { profileCacheTag } from '@/lib/getFeed'

// =============================================================================
//  lib/profileCache.js — the viewer-NEUTRAL half of a profile page, cached.
//
//  A profile's published articles (+ per-article unlock/comment/earnings) are
//  identical for every viewer, so they're cached across all requests and shared
//  — a popular profile collapses from a fresh posts-query + 3 stat RPCs per view
//  to roughly one render per window. The per-viewer bits (session, your
//  follow/block state, your feed reactions) live in the page and
//  getCachedAccountFeedPage, never in here.
//
//  This is the SINGLE most expensive thing a profile loads (the 3 aggregate RPCs
//  scan an author's whole unlock/comment/earnings history), and it scales with
//  article count — a prolific author with a big legacy archive pays far more than
//  someone with no articles. So the page no longer AWAITS it on the critical
//  path: it hands the promise to the client, which streams the article sections
//  in behind Suspense while the profile shell + own-posts feed render at once.
//  (The follower count — a cheap COUNT — stays on the critical path in the page.)
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

const EMPTY_ARTICLES = { error: null, posts: [] }

/** The author's published articles (each carrying its denormalized per-story
 *  reader count), cached viewer-neutral. `author` may be null (a handle-only
 *  profile with no author record) — then there are no articles. Returned as a
 *  promise the profile page streams in behind Suspense rather than blocking on. */
export async function getCachedArticleData({ accountId, author }) {
  if (!author) return EMPTY_ARTICLES
  const account = typeof accountId === 'string' ? accountId.trim() : null
  const authorId = author.id ?? null

  return unstable_cache(
    async () => loadProfileArticles(author),
    ['profile-articles', account ?? 'none', authorId ?? 'none'],
    {
      tags: account ? [profileCacheTag(account)] : [],
      revalidate: PROFILE_STATS_REVALIDATE_SECONDS,
    },
  )()
}
