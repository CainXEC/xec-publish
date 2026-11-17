// =============================================================================
//  xLinks.js — detect an X (Twitter) post link inside plain-text content so it
//  can render as an embedded post card (text + images/video, drawn by us from
//  X's public post data — see app/api/x-post/[id] + components/feed/XEmbed).
//
//  Mirrors lib/youtubeLinks.js: the second external-media exception. Same
//  surfaces (feed posts / quotes / replies / forum posts + comments, and article
//  bodies via lib/articleBodyLinks), same +1000 XEC surcharge on paid feed posts
//  (lib/feedPricing), same "first link embeds, its raw URL is stripped" rule.
//  Single source of truth for detection + stripping, shared by every surface AND
//  by pricing — the composer and the server confirm MUST agree on whether a post
//  embeds, or the on-chain amount check fails.
//
//  Host-allowlisted: x.com / twitter.com (+ www. / mobile. / m.), never a
//  lookalike (fox.com, x.com.evil.com, evil.com/x.com/…). The URL has to stand
//  as its own token (start of text, after whitespace, or after an opening
//  bracket/quote) so a link buried inside another site's URL never embeds.
// =============================================================================

const X_HOST = '(?:(?:www|mobile|m)\\.)?(?:x|twitter)\\.com'
// /<user>/status/<id> (or the legacy /statuses/), plus X's own /i/status/<id>
// and /i/web/status/<id> share forms. Usernames are 1–15 of [A-Za-z0-9_].
const X_PATH = '\\/(?:i\\/web|[A-Za-z0-9_]{1,15})\\/status(?:es)?\\/(\\d{1,20})'
// Left boundary: start, whitespace, or an opening bracket/quote. Captured (not a
// lookbehind) so older Safari can parse the regex.
const X_LEFT = '(^|[\\s(\\[{<"\'«])'

const X_ID_RE = new RegExp(`${X_LEFT}(?:https?:\\/\\/)?${X_HOST}${X_PATH}(?!\\d)`, 'i')

// Consumes the whole URL token (id + any /photo/1, ?s=20, #… tail) so it can be
// spliced out — but leaves trailing sentence punctuation in the text.
const X_STRIP_RE = new RegExp(
  `${X_LEFT}(?:https?:\\/\\/)?${X_HOST}${X_PATH}(?!\\d)[^\\s]*?(?=[.,;:!?)\\]}'"»]*(?:\\s|$))`,
  'i',
)

/** The first X post id referenced in `content` (a digit string), or null. */
export function extractXPostId(content) {
  const text = typeof content === 'string' ? content : ''
  if (!text) return null
  const m = X_ID_RE.exec(text)
  return m ? m[2] : null
}

/**
 * The X post id a feed post / comment should render as an embedded card, or
 * null. The ONE embed decision for every feed render surface — like
 * youTubeIdForPost, it ignores `post.action` (a reply pays the same surcharge as
 * a post, so it shows the same card).
 */
export function xPostIdForPost(post) {
  if (!post || post.deleted) return null
  return extractXPostId(post.content)
}

/**
 * Remove the first X post URL from `content` for display — it renders as an
 * embedded card, so the raw URL is redundant. Collapses the whitespace the
 * removed token leaves behind and trims the ends — unless `tidy: false`, for a
 * text node in the MIDDLE of article HTML, where trimming would glue the words
 * on either side of it to the neighbouring elements.
 */
export function stripXPostLink(content, { tidy = true } = {}) {
  const text = typeof content === 'string' ? content : ''
  if (!text) return text
  const removed = text.replace(X_STRIP_RE, '$1')
  if (!tidy) return removed
  return removed
    .replace(/[^\S\n]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** The canonical public URL of an X post (used for "view on X" fallbacks). */
export function xPostUrl(id) {
  return `https://x.com/i/status/${encodeURIComponent(String(id ?? ''))}`
}
