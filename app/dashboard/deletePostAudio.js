'use server'

import { removePostAudioStorageFiles } from '@/lib/audioConfig'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export async function deletePostAudio(postId) {
  const id = typeof postId === 'string' ? postId.trim() : ''
  if (!id) {
    return { ok: false, error: 'Post ID is required.' }
  }

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError) {
    return { ok: false, error: userError.message }
  }
  if (!user) {
    return { ok: false, error: 'You must be signed in to delete audio.' }
  }

  const { data: post, error: postError } = await supabase
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
  if (post.author_id !== user.id) {
    return { ok: false, error: 'You can only delete audio on your own posts.' }
  }

  const supabaseAdmin = createSupabaseAdminClient()
  if (!supabaseAdmin) {
    return {
      ok: false,
      error: 'Server configuration error: missing Supabase admin credentials.',
    }
  }

  const cleanupResult = await removePostAudioStorageFiles(supabaseAdmin, id)
  if (!cleanupResult.ok) {
    return { ok: false, error: cleanupResult.error }
  }

  const { error: updateError } = await supabaseAdmin
    .from('posts')
    .update({
      audio_url: null,
      audio_generated_at: null,
      audio_char_count: null,
      audio_source_hash: null,
      audio_voice: null,
    })
    .eq('id', id)
    .eq('author_id', user.id)

  if (updateError) {
    return { ok: false, error: updateError.message }
  }

  return { ok: true }
}
