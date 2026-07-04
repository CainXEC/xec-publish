'use server'

import { removePostAudioStorageFiles } from '@/lib/audioConfig'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getAuthedAccount } from '@/lib/authHelpers'

export async function deletePostAudio(postId) {
  const id = typeof postId === 'string' ? postId.trim() : ''
  if (!id) {
    return { ok: false, error: 'Post ID is required.' }
  }

  const acct = await getAuthedAccount()
  if (!acct?.authorId) {
    return { ok: false, error: 'You must be signed in to delete audio.' }
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
    return { ok: false, error: 'You can only delete audio on your own posts.' }
  }

  const cleanupResult = await removePostAudioStorageFiles(admin, id)
  if (!cleanupResult.ok) {
    return { ok: false, error: cleanupResult.error }
  }

  const { error: updateError } = await admin
    .from('posts')
    .update({
      audio_url: null,
      audio_generated_at: null,
      audio_char_count: null,
      audio_source_hash: null,
      audio_voice: null,
    })
    .eq('id', id)
    .eq('author_id', acct.authorId)

  if (updateError) {
    return { ok: false, error: updateError.message }
  }

  return { ok: true }
}
