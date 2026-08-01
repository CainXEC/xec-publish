import { unstable_cache } from 'next/cache'
import { adminDb } from '@/lib/db'
import { getPublishedPostBySlug } from '@/lib/getPublishedPostBySlug'
import { splitPostBodyAtPaywall, hasLockedBodyContent } from '@/lib/splitPostBodyAtPaywall'
import { sanitizePostBodyHtml } from '@/lib/sanitizePostBodyHtml'

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
  let data = await getPublishedPostBySlug(slug)
  let legacy = false
  if (!data) {
    data = await getPublishedPostBySlug(slug, true)
    legacy = true
  }
  if (!data) return null

  // Strip the raw body — only the sanitized PUBLIC preview is cached.
  const { body, ...post } = data.post
  const { bodyPublic, bodyLocked, hasPaywall } = splitPostBodyAtPaywall(body, { postId: post.id })

  return {
    legacy,
    post,
    author: data.author ?? null,
    authorAccountId: data.authorAccountId ?? null,
    unlockCount: data.unlockCount ?? 0,
    commentCount: data.commentCount ?? 0,
    hasPaywall,
    // Viewer-neutral: whether unlocking reveals hidden writing or only grants
    // commenting (author locked nothing). Safe to cache — not per-viewer.
    hasLockedContent: hasLockedBodyContent(bodyLocked),
    publicBodyHtml: sanitizePostBodyHtml(bodyPublic),
  }
}

/** Viewer-NEUTRAL reader payload, cached per slug: post metadata + author +
 *  counts + hasPaywall + the sanitized PUBLIC body. No locked content. */
export function getCachedPublicReaderPayload(slug) {
  return unstable_cache(
    () => computePublicReaderPayload(slug),
    ['reader-public', slug],
    { tags: [readerCacheTag(slug)], revalidate: READER_REVALIDATE_SECONDS },
  )()
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
