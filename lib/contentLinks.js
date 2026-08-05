// =============================================================================
//  contentLinks.js — the ONE policy for links inside user-authored content
//  (feed posts + article bodies). The rule the platform enforces:
//
//    Only three kinds of link are "live"; everything else is inert text.
//      1. on-site article       /posts/<slug>
//      2. on-site feed post      /feed/<txid>
//      3. @handle mention        -> /@handle
//
//  Feed posts are plain text, so this module exposes pure detectors/tokenizers
//  the feed renderer + getFeed decorators share. Article bodies are HTML; the
//  publish-time transform (lib/articleBodyLinks.js) reuses the same detectors so
//  feed and articles can never drift on what counts as a live link.
// =============================================================================

// Hosts we treat as "us" when an absolute URL is pasted. Root-relative links are
// always on-site; an absolute link to any OTHER host is external (inert).
export const POW_HOSTS = new Set(['proofofwriting.com', 'www.proofofwriting.com'])

// A handle is 1–15 chars of [A-Za-z0-9_] (mirrors HANDLE_RE in lib/handleSkeleton).
// A BARE eCash address (no "ecash:" prefix) mention is exactly 42 chars of
// [a-z0-9] — the same "looks like an address" convention used elsewhere
// (components/ArticleComments.js, app/api/activity/route.ts profileHref) for
// crediting a wallet that has no handle, e.g. "@qqfmw…4uh". Tried FIRST (with a
// following-boundary check) so it wins over the 15-char handle cap: without this,
// a 42-char address mention got TRUNCATED to its first 15 chars — a garbage
// "handle" that resolves nowhere and 404s — instead of linking to the real
// address profile /@qqfmw…4uh (which DOES resolve, via the address path in
// resolveProfileByIdentifier).
const HANDLE_CHARS = 'A-Za-z0-9_'
const HANDLE_MAX = 15
const ADDRESS_LEN = 42
const MENTION_SOURCE =
  `@[a-z0-9]{${ADDRESS_LEN}}(?![${HANDLE_CHARS}])|@[${HANDLE_CHARS}]{1,${HANDLE_MAX}}`
const BOUNDARY_BEFORE = new RegExp(`[${HANDLE_CHARS}@./]`)

function mentionBoundaryOk(prevChar) {
  return !prevChar || !BOUNDARY_BEFORE.test(prevChar)
}

/**
 * Split plain text into an ordered list of tokens:
 *   { type: 'text', value }            — literal text (rendered as-is / inert)
 *   { type: 'mention', handle, value } — an @handle mention (-> /@handle)
 * A run with no mentions yields a single text token. Used by the feed renderer
 * (to build inline mention links) and the article transform (to wrap text nodes).
 */
export function tokenizeMentions(text) {
  const src = typeof text === 'string' ? text : ''
  const tokens = []
  if (!src) return tokens
  const re = new RegExp(MENTION_SOURCE, 'g')
  let last = 0
  let m
  while ((m = re.exec(src))) {
    const start = m.index
    // Glued to a word/path char → not a mention; leave it in the text run.
    if (!mentionBoundaryOk(src[start - 1])) continue
    if (start > last) tokens.push({ type: 'text', value: src.slice(last, start) })
    tokens.push({ type: 'mention', handle: m[0].slice(1), value: m[0] })
    last = start + m[0].length
  }
  if (last < src.length) tokens.push({ type: 'text', value: src.slice(last) })
  return tokens
}

// ---- on-site feed-post links (mirrors the article-link detectors) -----------
// A feed post URL carries a 64-hex txid: /feed/<txid>, absolute (any host) or
// root-relative, with optional query/hash.
const FEED_LINK_RE = /(?:https?:\/\/[^\s/]+)?\/feed\/([0-9a-f]{64})/i
const FEED_LINK_STRIP_RE = /(?:https?:\/\/[^\s/]+)?\/feed\/[0-9a-f]{64}[^\s]*/i

/** The first on-site feed-post txid referenced in `content`, lowercased, or null. */
export function extractFeedPostTxid(content) {
  const text = typeof content === 'string' ? content : ''
  if (!text) return null
  const m = FEED_LINK_RE.exec(text)
  return m ? m[1].toLowerCase() : null
}

/**
 * Remove the first on-site feed-post URL from `content` for display — the feed
 * renders a quoted embed that is itself the link, so the raw URL is redundant.
 * Collapses the whitespace the removed token leaves behind and trims the ends.
 */
export function stripFeedPostLink(content) {
  const text = typeof content === 'string' ? content : ''
  if (!text) return text
  return text
    .replace(FEED_LINK_STRIP_RE, '')
    .replace(/[^\S\n]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ---- article-body anchor policy --------------------------------------------
// Given a raw href, return the normalized on-site PATH if it points at one of
// the three live kinds (article / feed post / profile), else null (external ⇒
// the anchor is unwrapped to plain text at publish time).
const LIVE_PATH_RE = /^\/(?:posts|feed|profile|a)\/[^\s]|^\/@[^\s/]/i

export function powInternalHref(rawHref) {
  const href = String(rawHref ?? '').trim()
  if (!href) return null
  let path
  if (href.startsWith('/')) {
    path = href
  } else {
    let u
    try {
      u = new URL(href)
    } catch {
      return null
    }
    if (!POW_HOSTS.has(u.hostname.toLowerCase())) return null
    path = `${u.pathname}${u.search}${u.hash}`
  }
  return LIVE_PATH_RE.test(path) ? path : null
}

// ---- inline same-site URL links (plain-text surfaces: feed + comments) ------
// A pasted absolute URL to one of OUR hosts becomes a live internal link to its
// relative path; any other URL is left as inert text (the platform surfaces no
// external links). The emitted href is always root-relative, so it's XSS-safe as
// an internal <Link> target. Sentence/markup punctuation is almost never part of
// the URL itself, so it's trimmed off the tail.
const URL_TRAILING_RE = /[.,;:!?)\]}'"»]+$/

/**
 * The on-site relative path (pathname+search+hash) for an absolute URL whose host
 * is one of ours, else null (external, non-http, or unparseable). Never returns
 * anything that isn't root-relative — callers use it directly as an internal href.
 */
export function powUrlToPath(rawUrl) {
  let u
  try {
    u = new URL(String(rawUrl ?? ''))
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  if (!POW_HOSTS.has(u.hostname.toLowerCase())) return null
  const path = `${u.pathname}${u.search}${u.hash}`
  return path.startsWith('/') ? path : null
}

/**
 * Split plain text into { type:'text', value } and { type:'link', href, value }
 * tokens. Absolute URLs to POW_HOSTS become link tokens (href = relative path);
 * every other URL stays inside a text token. No mention handling here — compose
 * with tokenizeMentions via tokenizeContent for the full feed-body set.
 */
export function tokenizeUrls(text) {
  const src = typeof text === 'string' ? text : ''
  const tokens = []
  if (!src) return tokens
  const re = /https?:\/\/[^\s]+/gi
  let last = 0
  let m
  while ((m = re.exec(src))) {
    const start = m.index
    let url = m[0]
    // Don't pull trailing punctuation into the URL / clickable link.
    const trail = URL_TRAILING_RE.exec(url)
    const trailing = trail ? trail[0] : ''
    if (trailing) url = url.slice(0, url.length - trailing.length)
    if (start > last) tokens.push({ type: 'text', value: src.slice(last, start) })
    const href = powUrlToPath(url)
    tokens.push(href ? { type: 'link', href, value: url } : { type: 'text', value: url })
    if (trailing) tokens.push({ type: 'text', value: trailing })
    last = start + m[0].length
  }
  if (last < src.length) tokens.push({ type: 'text', value: src.slice(last) })
  return tokens
}

/**
 * The full inline-link tokenizer for a feed body: on-site URL links PLUS @handle
 * mentions. Emits { type:'text' } / { type:'mention', handle, value } /
 * { type:'link', href, value }. URLs are detected first (so an @ inside a URL is
 * never read as a mention), then mentions within the remaining text runs.
 */
export function tokenizeContent(text) {
  const tokens = []
  for (const tok of tokenizeUrls(text)) {
    if (tok.type === 'text') {
      for (const t of tokenizeMentions(tok.value)) tokens.push(t)
    } else {
      tokens.push(tok)
    }
  }
  return tokens
}
