export const XEC_PER_CHARACTER = 0.5
export const AUDIO_MIN_XEC = 100

export function getPlainTextFromHtml(htmlBody) {
  if (!htmlBody) return ''
  return String(htmlBody)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function getPlainTextCharCount(htmlBody) {
  return getPlainTextFromHtml(htmlBody).length
}

export function calculateAudioPriceXec(charCount) {
  if (!charCount || charCount < 0) return 0
  return Math.ceil(charCount * XEC_PER_CHARACTER)
}

export function getAudioPriceForPost(charCount) {
  const calculated = calculateAudioPriceXec(charCount)
  return Math.max(calculated, AUDIO_MIN_XEC)
}
