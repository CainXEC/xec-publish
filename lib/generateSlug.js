export function generateSlug(title) {
  const latin = title
    .toLowerCase()
    .replace(/[^\x00-\x7F]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')

  return latin || `post-${Date.now()}`
}

/** True only for non-empty slugs safe in URL paths (lowercase a–z, digits, single hyphens between segments). */
export function isUrlSafeSlug(str) {
  const s = str.trim()
  if (!s) return false
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s)
}
