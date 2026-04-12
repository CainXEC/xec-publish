/**
 * Estimate read time from HTML body (paywalled content). Returns null if empty.
 */
export function getReadingTime(body) {
  if (!body) return null
  const text = String(body).replace(/<[^>]*>/g, '').trim()
  if (!text) return null
  const words = text.split(/\s+/).filter(Boolean).length
  if (words === 0) return null
  const minutes = Math.ceil(words / 200)
  return minutes === 1 ? '1 min read' : `${minutes} min read`
}
