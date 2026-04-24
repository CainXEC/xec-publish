import { createHash } from 'node:crypto'
import {
  AUDIO_MIN_XEC,
  XEC_PER_CHARACTER,
  calculateAudioPriceXec,
  getAudioPriceForPost,
  getPlainTextCharCount,
  getPlainTextFromHtml,
} from '@/lib/audioPricing'

// OpenAI TTS config
export const TTS_MODEL = 'gpt-4o-mini-tts'
export const TTS_VOICE = 'verse'
export const TTS_INSTRUCTIONS =
  'Speak sincerely, warmly, and naturally, like a thoughtful friend reading a letter aloud.'

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
export const AUDIO_MAX_TOTAL_CHARS = 100_000 // ~50 minutes of audio; adjust if needed

// Supabase Storage config
export const AUDIO_STORAGE_BUCKET = 'post-audio'
