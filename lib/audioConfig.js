import { createHash } from 'node:crypto'
import {
  AUDIO_MIN_XEC,
  XEC_PER_CHARACTER,
  calculateAudioPriceXec,
  getAudioPriceForPost,
  getPlainTextCharCount,
  getPlainTextFromHtml,
} from '@/lib/audioPricing'

export {
  AUDIO_MIN_XEC,
  XEC_PER_CHARACTER,
  calculateAudioPriceXec,
  getAudioPriceForPost,
  getPlainTextCharCount,
  getPlainTextFromHtml,
}

export function hashPostBody(body) {
  const plain = getPlainTextFromHtml(body)
  return createHash('sha256').update(plain).digest('hex')
}

export function isAudioStale(currentBody, storedHash) {
  if (!storedHash) return false
  return hashPostBody(currentBody) !== String(storedHash).trim()
}

/** Max total TTS input length (title + body) to avoid timeouts and runaway API cost */
export const AUDIO_MAX_TOTAL_CHARS = 200_000 // ~50 minutes of audio; adjust if needed

// Supabase Storage config
export const AUDIO_STORAGE_BUCKET = 'post-audio'

function isStorageObjectMissingError(error) {
  if (!error) return false
  const msg = (error.message || '').toLowerCase()
  return (
    msg.includes('not found') ||
    msg.includes('does not exist') ||
    msg.includes('object not found')
  )
}

/** Remove every object in post-audio whose name contains postId (service-role client). */
export async function removePostAudioStorageFiles(supabaseAdmin, postId) {
  const id = typeof postId === 'string' ? postId.trim() : ''
  if (!id) return { ok: true }

  const { data: files, error: listError } = await supabaseAdmin.storage
    .from(AUDIO_STORAGE_BUCKET)
    .list('', { search: id })

  if (listError) {
    return { ok: false, error: listError.message }
  }

  const paths = (files ?? [])
    .map((file) => file.name)
    .filter((name) => typeof name === 'string' && name.length > 0 && name.includes(id))

  if (paths.length === 0) {
    return { ok: true }
  }

  const { error: removeError } = await supabaseAdmin.storage
    .from(AUDIO_STORAGE_BUCKET)
    .remove(paths)

  if (removeError && !isStorageObjectMissingError(removeError)) {
    return { ok: false, error: removeError.message }
  }

  return { ok: true }
}
