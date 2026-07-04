'use server'

import { removePostAudioStorageFiles } from '@/lib/audioConfig'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getAuthedAccount } from '@/lib/authHelpers'

/**
 * Delete a post the current author owns. Authorization is the wallet session
 * (getAuthedAccount), not the retired Supabase email session. Audio storage
 * files are removed first so hard-deleting the row can't orphan blobs.
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

  const admin = createSupabaseAdminClient()
  if (!admin) {
    return {
      ok: false,
      error: 'Server configuration error: missing Supabase admin credentials.',
    }
  }

  const { data: post, error: postError } = await admin
    .from('posts')
    .select('id, author_id, audio_url')
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

  // Purge audio storage first (only if this post has audio) so the row delete
  // below doesn't leave orphaned blobs in storage.
  if (post.audio_url) {
    const cleanupResult = await removePostAudioStorageFiles(admin, id)
    if (!cleanupResult.ok) {
      return { ok: false, error: cleanupResult.error }
    }
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

  return { ok: true }
}
