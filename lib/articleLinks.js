// =============================================================================
//  articleLinks.js — detect links to on-site articles inside feed post content.
//  Feed posts are plain text (see feedProtocol); when an author pastes a link to
//  one of their published articles (/posts/<slug>), the feed renders a preview
//  card for it. This module is the single source of truth for what counts as an
//  article link and how to pull the slug out — shared by the server-side card
//  attach (getFeed) and the client-side optimistic hydrate (ArticleCard).
// =============================================================================

// Matches an article URL whether absolute (any host) or root-relative, e.g.
//   https://www.proofofwriting.com/posts/my-slug
//   http://localhost:3000/posts/my-slug?ref=x
//   /posts/my-slug
// The slug is everything up to the next slash, whitespace, or query/hash.
const ARTICLE_LINK_RE = /(?:https?:\/\/[^\s/]+)?\/posts\/([^\s/?#]+)/i

/** Trailing punctuation that commonly abuts a pasted URL but isn't part of the slug. */
function trimTrailingPunctuation(slug) {
  return slug.replace(/[.,;:!?)\]}'"]+$/, '')
}

/**
 * Return the first on-site article slug referenced in `content`, or null.
 * Slugs are URL-decoded to match how getPublishedPostBySlug looks them up.
 */
export function extractArticleSlug(content) {
  const text = typeof content === 'string' ? content : ''
  if (!text) return null
  const m = ARTICLE_LINK_RE.exec(text)
  if (!m) return null
  const raw = trimTrailingPunctuation(m[1])
  if (!raw) return null
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}
