import { cache } from 'react'
import { unstable_cache } from 'next/cache'
import { adminDb } from '@/lib/db'
import { sumAmountRowsByPostId } from '@/lib/supabaseUnlockEarnings'
import { displayHandlesByAuthorId } from '@/lib/authorDisplayHandles'
import { accountIdForAuthorId } from '@/lib/accountAuthorLink'

function countRowsByPostId(rows) {
  const map = {}
  if (!Array.isArray(rows)) return map
  for (const r of rows) {
    if (r?.post_id == null) continue
    const n = typeof r.count === 'number' ? r.count : Number(r.count)
    map[r.post_id] = Number.isFinite(n) ? n : 0
  }
  return map
}

/** The actual query work. Viewer-NEUTRAL (no cookies / entitlement) so its result
 *  is safe to share across requests — the callers (preparePublicPostPageData,
 *  lib/readerPayload) still split the body at the paywall and gate the locked
 *  half on the per-request entitlement, so nothing here decides who sees what. */
async function computePublishedPost(slug, legacy) {
  const supabase = adminDb()

  const { data: postRow, error: postError } = await supabase
    .from('posts')
    .select(
      'id, author_id, title, teaser, body, price_xec, published, pinned, slug, created_at, published_at, reading_time_minutes, authors ( username, xec_address, is_ai )',
    )
    .eq('slug', slug)
    .eq('published', true)
    .eq('legacy', legacy)
    .maybeSingle()

  if (postError || !postRow) return null

  const authorRel = postRow.authors
  const authorRowRaw = Array.isArray(authorRel) ? authorRel[0] : authorRel
  const postIds = [postRow.id]

  // The byline handle, the counts, earnings, and the author's account id all
  // depend only on the post row — run them together (handleMap used to be a
  // separate sequential wave).
  const [handleMap, unlockRes, commentRes, earnedRes, authorAccountId] = await Promise.all([
    displayHandlesByAuthorId([postRow.author_id], supabase),
    supabase.rpc('get_unlock_counts', { post_ids: postIds, since: null }),
    supabase.rpc('get_comment_counts', { post_ids: postIds }),
    supabase.rpc('get_unlock_earnings', { post_ids: postIds, since: null }),
    // author_id -> account id (the followee key for the account-keyed follow graph).
    accountIdForAuthorId(supabase, postRow.author_id),
  ])

  // Prefer the author's chosen handle (accounts.display_handle) for the byline,
  // falling back to authors.username when they haven't bound one.
  const handleEntry = handleMap[postRow.author_id] ?? null
  const authorRow = authorRowRaw
    ? {
        ...authorRowRaw,
        display_handle: handleEntry?.handle ?? null,
        handle_color: handleEntry?.color ?? null,
      }
    : null

  const earningsById = earnedRes.error ? {} : sumAmountRowsByPostId(earnedRes.data ?? [])
  const post = {
    ...postRow,
    earnings: earningsById[postRow.id] ?? 0,
  }
  delete post.authors

  const unlockById = unlockRes.error ? {} : countRowsByPostId(unlockRes.data ?? [])
  const commentById = commentRes.error ? {} : countRowsByPostId(commentRes.data ?? [])

  return {
    post,
    author: authorRow ?? null,
    authorAccountId: authorAccountId ?? null,
    unlockCount: unlockById[post.id] ?? 0,
    commentCount: commentById[post.id] ?? 0,
  }
}

/**
 * Published post by slug, for the article page, its generateMetadata, the legacy
 * root route, the in-pane reader, and translate.
 *
 * Two layers of caching:
 *  - React `cache()` dedupes within ONE request (generateMetadata + the page).
 *  - `unstable_cache` shares the viewer-neutral result ACROSS requests (per
 *    slug+legacy, 60s, tag `reader:<slug>`, invalidated on save/publish in
 *    app/dashboard/savePost). This is what makes the full article page — the
 *    path mobile takes, since the desktop reading pane doesn't render there —
 *    stop re-running ~3 query waves on every open.
 *
 * `legacy` is a boolean primitive so the cache key + React dedupe compare by
 * value. Current posts live at `/posts/{slug}` (legacy=false); imported legacy
 * posts live at root `/{slug}` (legacy=true, app/[slug]/page.js).
 */
export const getPublishedPostBySlug = cache(async (rawSlug, legacy = false) => {
  const slug =
    typeof rawSlug === 'string' ? decodeURIComponent(rawSlug.trim()) : ''
  if (!slug) return null

  return unstable_cache(
    () => computePublishedPost(slug, legacy),
    ['published-post', slug, String(legacy)],
    { tags: [`reader:${slug}`], revalidate: 60 },
  )()
})
