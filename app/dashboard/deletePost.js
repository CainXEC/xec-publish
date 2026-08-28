'use server'

import { revalidateTag } from 'next/cache'
import { adminDb } from '@/lib/db'
import { getAuthedAccount } from '@/lib/authHelpers'
import { ARTICLES_RAIL_CACHE_TAG } from '@/app/api/articles/rail/route'

/**
 * Delete a post the current author owns. Authorization is the wallet session
 * (getAuthedAccount), not the retired Supabase email session.
 */
export async function deletePost(postId) {
  const id = typeof postId === 'string' ? postId.trim() : ''
  if (!id) {
    return { ok: false, error: 'Post ID is required.' }
  }

  const acct = await getAuthedAccount()
  if (!acct?.authorId) {
    return { ok: false, error: 'You must be signed in to delete a post.' }
  }

  const admin = adminDb()

  const { data: post, error: postError } = await admin
    .from('posts')
    .select('id, author_id')
    .eq('id', id)
    .maybeSingle()

  if (postError) {
    return { ok: false, error: postError.message }
  }
  if (!post) {
    return { ok: false, error: 'Post not found.' }
  }
  if (post.author_id !== acct.authorId) {
    return { ok: false, error: 'You can only delete your own posts.' }
  }

  const { error: deleteError, count } = await admin
    .from('posts')
    .delete({ count: 'exact' })
    .eq('id', id)
    .eq('author_id', acct.authorId)

  if (deleteError) {
    return { ok: false, error: deleteError.message }
  }
  if (typeof count === 'number' && count === 0) {
    return {
      ok: false,
      error: 'Could not delete this post. It may have already been removed.',
    }
  }

  // The front page rail caches its list server-side (see the route) — without
  // this, a deleted article kept showing there for up to its 60s cache window.
  try {
    revalidateTag(ARTICLES_RAIL_CACHE_TAG)
  } catch {
    /* no request scope (e.g. a test) — a later request just re-caches normally */
  }

  return { ok: true }
}
