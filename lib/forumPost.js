// =============================================================================
//  lib/forumPost.js — a forum post's title + body <-> stored content.
//
//  A forum top-level post is a TITLE plus an optional BODY. On chain (and in the
//  feed_posts.content column) the two are stored as ONE blob: `title \n\n body`
//  (or just `title` when there's no body). That way the existing
//  sha256(content) "proof of writing" hash covers the title AND the body with no
//  change to the OP_RETURN protocol. These helpers are the single source of truth
//  for that join/split, shared by the composer (client), the confirm route, and
//  getFeed. Client-safe — no server-only imports.
// =============================================================================

// Titles are a single line; keep them tweet-headline short.
export const FORUM_TITLE_MAX = 200

// The title/body separator inside stored content. A blank line — natural to read
// on chain, and titles never contain one (single-line input), so the split is
// unambiguous on the FIRST occurrence.
const DELIM = '\n\n'

/** Join a title + optional body into the single content blob that gets hashed. */
export function combineForumContent(title, body) {
  const t = (typeof title === 'string' ? title : '').trim()
  const b = (typeof body === 'string' ? body : '').trim()
  return b ? `${t}${DELIM}${b}` : t
}

/** Split stored content back into { title, body }. Title = everything before the
 *  first blank line; body = the rest (empty when the post is title-only). */
export function splitForumContent(content) {
  const s = typeof content === 'string' ? content : ''
  const idx = s.indexOf(DELIM)
  if (idx === -1) return { title: s, body: '' }
  return { title: s.slice(0, idx), body: s.slice(idx + DELIM.length) }
}
