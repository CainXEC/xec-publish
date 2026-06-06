const PAYWALL_MARKER = '<div data-paywall-break="true"></div>'
const PAYWALL_MARKER_REGEX =
  /<div[^>]*data-paywall-break(?:="true")?[^>]*>\s*<\/div>/i

/**
 * Split HTML at the TipTap paywall break (`data-paywall-break="true"`).
 * @returns {{ bodyPublic: string, bodyLocked: string | null, hasPaywall: boolean }}
 */
export function splitPostBodyAtPaywall(html, { postId } = {}) {
  const src = typeof html === 'string' ? html : ''

  const exactIdx = src.indexOf(PAYWALL_MARKER)
  if (exactIdx !== -1) {
    const markerEnd = exactIdx + PAYWALL_MARKER.length
    return {
      bodyPublic: src.slice(0, markerEnd),
      bodyLocked: src.slice(markerEnd),
      hasPaywall: true,
    }
  }

  const match = PAYWALL_MARKER_REGEX.exec(src)
  if (!match) {
    if (postId) {
      console.warn(
        `[paywall] no paywall marker in post ${postId}; treating entire body as public`,
      )
    }
    return { bodyPublic: src, bodyLocked: null, hasPaywall: false }
  }

  const markerEnd = match.index + match[0].length
  return {
    bodyPublic: src.slice(0, markerEnd),
    bodyLocked: src.slice(markerEnd),
    hasPaywall: true,
  }
}
