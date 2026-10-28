import { unstable_cache } from 'next/cache'
import { adminDb } from '@/lib/db'
import { getPublishedPostBySlugWithStatus } from '@/lib/getPublishedPostBySlug'
import { splitPostBodyAtPaywall, hasLockedBodyContent } from '@/lib/splitPostBodyAtPaywall'
import { sanitizePostBodyHtml } from '@/lib/sanitizePostBodyHtml'
import { UncachedResult, serveUncached } from '@/lib/uncachedResult'

// =============================================================================
//  lib/readerPayload.js — the in-pane reader's server data, split by trust.
//
//  The /api/posts/reader/[slug] route was fully dynamic: on every rail click it
//  re-ran ~3 query waves (post + author handle + unlock/comment counts) AND a
//  jsdom sanitize of the body. All of that except the per-viewer entitlement is
//  identical for every reader of a slug, so it's cached here.
//
//  PAYWALL SAFETY: the cached payload holds ONLY the sanitized PUBLIC preview —
//  the raw/locked body is stripped before caching and never stored. The entitled
//  full body is prepared FRESH per request (fullReaderBodyHtml), so locked
//  content cannot leak through the shared cache even if entitlement were misread.
// =============================================================================

const READER_REVALIDATE_SECONDS = 60

/** Invalidate a slug's cached reader payload (call on edit/publish/delete). */
export const readerCacheTag = (slug) => `reader:${slug}`

async function computePublicReaderPayload(slug) {
  let { data, failed } = await getPublishedPostBySlugWithStatus(slug, false)
  let legacy = false
  if (!data) {
    const old = await getPublishedPostBySlugWithStatus(slug, true)
    data = old.data
    failed = failed || old.failed
    legacy = true
  }
  // A lookup failed upstream: answer this request, but cache nothing derived
  // from it (lib/uncachedResult.js) — not a "not found", not "0 unlocks".
  if (!data) {
    if (failed) throw new UncachedResult(null, 'post lookup')
    return null
  }

  // Strip the raw body — only the sanitized PUBLIC preview is cached.
  const { body, ...post } = data.post
  const { bodyPublic, bodyLocked, hasPaywall } = splitPostBodyAtPaywall(body, { postId: post.id })

  const payload = {
    legacy,
    post,
    author: data.author ?? null,
    authorAccountId: data.authorAccountId ?? null,
    // null = the count lookup failed upstream (unknown), not zero.
    unlockCount: data.unlockCount,
    commentCount: data.commentCount,
    hasPaywall,
    // Viewer-neutral: whether unlocking reveals hidden writing or only grants
    // commenting (author locked nothing). Safe to cache — not per-viewer.
    hasLockedContent: hasLockedBodyContent(bodyLocked),
    publicBodyHtml: sanitizePostBodyHtml(bodyPublic),
  }
  if (failed) throw new UncachedResult(payload, 'a lookup failed upstream')
  return payload
}

/** Viewer-NEUTRAL reader payload, cached per slug: post metadata + author +
 *  counts + hasPaywall + the sanitized PUBLIC body. No locked content. */
export function getCachedPublicReaderPayload(slug) {
  return serveUncached(
    unstable_cache(
      () => computePublicReaderPayload(slug),
      ['reader-public', slug],
      { tags: [readerCacheTag(slug)], revalidate: READER_REVALIDATE_SECONDS },
    )(),
  )
}

/** The sanitized FULL body (public + locked) for an ENTITLED viewer — prepared
 *  fresh, NEVER cached. Returns null on any failure so the caller can fall back
 *  to the public preview (a safe degrade). */
export async function fullReaderBodyHtml(postId) {
  try {
    const { data } = await adminDb()
      .from('posts')
      .select('body')
      .eq('id', postId)
      .maybeSingle()
    if (!data?.body) return null
    const { bodyPublic, bodyLocked } = splitPostBodyAtPaywall(data.body, { postId })
    const full = bodyLocked != null ? `${bodyPublic}${bodyLocked}` : bodyPublic
    return sanitizePostBodyHtml(full)
  } catch {
    return null
  }
}
