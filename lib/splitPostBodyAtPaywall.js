const PAYWALL_MARKER = '<div data-paywall-break="true"></div>'
const PAYWALL_MARKER_REGEX =
  /<div[^>]*data-paywall-break(?:="true")?[^>]*>\s*<\/div>/i

/**
 * Split HTML at the TipTap paywall break (`data-paywall-break="true"`).
 * bodyPublic = HTML before the marker (marker excluded).
 * bodyLocked = HTML after the marker (marker excluded), or null when no marker.
 * @returns {{ bodyPublic: string, bodyLocked: string | null, hasPaywall: boolean }}
 */
export function splitPostBodyAtPaywall(html, { postId } = {}) {
  const src = typeof html === 'string' ? html : ''

  let markerStart = src.indexOf(PAYWALL_MARKER)
  let markerEnd = markerStart !== -1 ? markerStart + PAYWALL_MARKER.length : -1

  if (markerStart === -1) {
    const match = PAYWALL_MARKER_REGEX.exec(src)
    if (!match) {
      if (postId) {
        console.warn(
          `[paywall] no paywall marker in post ${postId}; treating entire body as public`,
        )
      }
      return { bodyPublic: src, bodyLocked: null, hasPaywall: false }
    }
    markerStart = match.index
    markerEnd = markerStart + match[0].length
  }

  const bodyPublic = src.slice(0, markerStart)
  const bodyLocked = src.slice(markerEnd)

  if (markerStart === 0 && postId) {
    console.warn(
      `[paywall] paywall marker at start of post ${postId}; no public preview content`,
    )
  }

  return { bodyPublic, bodyLocked, hasPaywall: true }
}

/**
 * True when a paywall's locked side actually holds readable writing — not just
 * whitespace or empty tags. Lets the reader UI tell two cases apart: "unlock to
 * reveal the hidden rest of the story" vs. "the author locked nothing, so
 * unlocking only grants commenting." Article bodies are text-only (no images
 * off-NFT), so a stripped-text check is sufficient.
 * @param {string | null | undefined} bodyLocked
 * @returns {boolean}
 */
export function hasLockedBodyContent(bodyLocked) {
  if (typeof bodyLocked !== 'string') return false
  return (
    bodyLocked
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/\s+/g, '').length > 0
  )
}
