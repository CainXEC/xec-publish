// =============================================================================
//  forumLinks.js — detect links to on-site FORUMS inside feed post content.
//  A forum lives at /f/<slug>; when an author pastes one into a feed post, the
//  feed renders a preview card for it (like an article link → ArticleCard). This
//  is the single source of truth for what counts as a forum link and how to pull
//  the slug out — shared by the server-side card attach (getFeed) and the
//  client-side optimistic hydrate (ForumCard).
//
//  NOTE: /f/ is distinct from /feed/ — a forum URL is `/f/` + slug, while a feed
//  post is `/feed/` + txid, so these detectors never fire on a feed-post link.
// =============================================================================

// A forum slug is 2–24 chars of [A-Za-z0-9_] (mirrors FORUM_SLUG_RE in
// lib/forums). Absolute (any host) or root-relative; the trailing lookahead ends
// the slug at the first non-slug char so /f/AI/anything still resolves /f/AI.
const FORUM_LINK_RE = /(?:https?:\/\/[^\s/]+)?\/f\/([A-Za-z0-9_]{2,24})(?![A-Za-z0-9_])/i

// Like FORUM_LINK_RE but consumes the whole URL token so it can be spliced out.
const FORUM_LINK_STRIP_RE = /(?:https?:\/\/[^\s/]+)?\/f\/[A-Za-z0-9_]{2,24}[^\s]*/i

/** The first on-site forum slug referenced in `content`, or null. */
export function extractForumSlug(content) {
  const text = typeof content === 'string' ? content : ''
  if (!text) return null
  const m = FORUM_LINK_RE.exec(text)
  return m ? m[1] : null
}

/**
 * Remove the first on-site forum URL from `content` for display — the feed
 * renders a preview card that IS the link, so the raw URL is redundant.
 * Collapses the whitespace the removed token leaves behind and trims the ends.
 */
export function stripForumLink(content) {
  const text = typeof content === 'string' ? content : ''
  if (!text) return text
  return text
    .replace(FORUM_LINK_STRIP_RE, '')
    .replace(/[^\S\n]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
