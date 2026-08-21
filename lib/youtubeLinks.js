// =============================================================================
//  youtubeLinks.js — detect a YouTube video link inside plain-text content
//  (feed posts + top-level forum posts) so it can render as an embedded player.
//
//  This is the ONLY external-media exception to the "on-site links only, no
//  external URLs" policy, and it's scoped to TOP-LEVEL posts by the caller
//  (never comments / replies). Matches the common share forms — watch?v=, youtu.be,
//  /shorts/, /embed/, /v/ — and pulls the 11-char video id. Single source of
//  truth for detection + stripping, shared by every render surface.
// =============================================================================

// The 11-char video id is [A-Za-z0-9_-]. Host may be youtube.com / m. / music. /
// youtu.be, protocol optional. The trailing lookahead ends the id cleanly.
const YT_ID_RE =
  /(?:https?:\/\/)?(?:www\.|m\.|music\.)?(?:youtube\.com\/(?:watch\?(?:[^\s]*&)?v=|shorts\/|embed\/|v\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/i

// Consumes the whole URL token (id + any query/hash) so it can be spliced out.
const YT_STRIP_RE =
  /(?:https?:\/\/)?(?:www\.|m\.|music\.)?(?:youtube\.com\/(?:watch|shorts\/|embed\/|v\/|live\/)|youtu\.be\/)[^\s]*/i

/** The first YouTube video id referenced in `content`, or null. */
export function extractYouTubeId(content) {
  const text = typeof content === 'string' ? content : ''
  if (!text) return null
  const m = YT_ID_RE.exec(text)
  return m ? m[1] : null
}

/**
 * Remove the first YouTube URL from `content` for display — it renders as an
 * embedded player, so the raw URL is redundant. Collapses the whitespace the
 * removed token leaves behind and trims the ends.
 */
export function stripYouTubeLink(content) {
  const text = typeof content === 'string' ? content : ''
  if (!text) return text
  return text
    .replace(YT_STRIP_RE, '')
    .replace(/[^\S\n]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
