/**
 * Reading time in minutes from HTML body (strip tags, word count / 200, ceiling).
 * Call with the same body string you persist to `posts.body`.
 */
export function calculateReadingTimeMinutes(body) {
  const text = String(body ?? '')
    .replace(/<div[^>]*data-paywall-break(?:="true")?[^>]*>\s*<\/div>/gi, '')
    .replace(/<[^>]*>/g, '')
  const words = text.trim().split(/\s+/).length
  return Math.ceil(words / 200)
}
