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
  'Read this in a warm, unhurried, conversational tone — as if reading aloud to a single close friend in a quiet room. Let each sentence breathe. Take natural pauses at commas and ends of sentences, and a longer, deliberate pause between paragraphs — let the silence settle before moving on. Vary your pace: slow down for emphasis, pick up slightly when the thought is light. Sound thoughtful and present, never performative or announcer-like. Let the voice feel slightly reflective, like someone thinking as they speak.';

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
