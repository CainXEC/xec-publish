import DOMPurify from 'isomorphic-dompurify'
import { powInternalHref, externalUrlHref } from './contentLinks'

const ALLOWED_TAGS = [
  'p',
  'h1',
  'h2',
  'h3',
  'ul',
  'ol',
  'li',
  'blockquote',
  'strong',
  'b',
  'em',
  'i',
  'u',
  'br',
  'span',
  'a',
  // YouTube embed wrapper + player. The iframe's src is validated to a
  // youtube-nocookie /embed/<id> below; any other iframe is dropped entirely, so
  // `iframe` in the allowlist can't become an arbitrary-embed hole.
  'div',
  'iframe',
]

// The ONLY iframe src that survives — the privacy-enhanced YouTube embed the
// publish-time transform emits (lib/articleBodyLinks makeYouTubeEmbed).
const YT_EMBED_SRC_RE =
  /^https:\/\/www\.youtube-nocookie\.com\/embed\/[A-Za-z0-9_-]{11}(?:\?[^"'<>\s]*)?$/

let hooksInstalled = false

function installHooks() {
  if (hooksInstalled) return
  if (typeof DOMPurify.addHook !== 'function') return
  hooksInstalled = true
  DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
    if (data.attrName === 'style') {
      const v = (data.attrValue || '').replace(/\s+/g, ' ').trim()
      if (!/^text-align:\s*(left|center|right)\s*(;)?$/i.test(v)) {
        data.keepAttr = false
      }
      return
    }
    // Anchors only survive as LINKS when they carry a publish-time marker AND the
    // href re-validates: `data-pow` → an on-site live path (article/feed/profile);
    // `data-pow-ext` → an allowed external host (X / e.cash). Anything else loses
    // its href and renders as inert text — a pasted evil link, or a stale
    // pre-policy anchor, can never become clickable at read time.
    if (data.attrName === 'href') {
      const normalized =
        node.getAttribute?.('data-pow') != null
          ? powInternalHref(data.attrValue)
          : node.getAttribute?.('data-pow-ext') != null
            ? externalUrlHref(data.attrValue)
            : null
      if (!normalized) {
        data.keepAttr = false
        return
      }
      data.attrValue = normalized
    }
    // An iframe src survives ONLY if it's the validated YouTube embed.
    if (data.attrName === 'src') {
      if (!YT_EMBED_SRC_RE.test((data.attrValue || '').trim())) data.keepAttr = false
      return
    }
    // The only class we keep is the embed wrapper's — authors can't smuggle in
    // arbitrary classes (which could borrow site styles / layout).
    if (data.attrName === 'class') {
      if ((data.attrValue || '').trim() !== 'ytembed') data.keepAttr = false
    }
  })

  // After per-attribute sanitizing, lock down anchors: a live external link ALWAYS
  // opens in a new tab with a tab-nabbing/referrer guard (never trust author target
  // /rel), and any anchor that lost its href is stripped of the outbound + marker
  // attributes so it's cleanly inert.
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    // Drop any iframe whose src didn't survive validation (a non-YouTube embed) —
    // an empty iframe is useless and we never want an author-controlled one.
    if (node?.nodeName === 'IFRAME') {
      if (!node.getAttribute?.('src')) node.remove?.()
      return
    }
    if (!node || node.nodeName !== 'A') return
    const isExternal = node.getAttribute?.('data-pow-ext') != null
    const hasHref = node.hasAttribute?.('href')
    if (isExternal && hasHref) {
      node.setAttribute('target', '_blank')
      node.setAttribute('rel', 'noopener noreferrer nofollow')
      return
    }
    node.removeAttribute?.('target')
    node.removeAttribute?.('rel')
    if (!hasHref) {
      node.removeAttribute?.('data-pow')
      node.removeAttribute?.('data-pow-ext')
    }
  })
}

/**
 * Sanitize author HTML (scripts, event handlers, and unsafe styles removed).
 * Uses the same allowlist in Node (SSR) and the browser. On-site links produced
 * by the publish-time transform (lib/articleBodyLinks) pass through; every other
 * anchor keeps its text but loses its href (see installHooks).
 */
export function sanitizePostBodyHtml(dirty) {
  if (typeof dirty !== 'string') return ''
  if (DOMPurify.isSupported === false) return ''
  installHooks()
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: [
      'style',
      'href',
      'data-pow',
      'data-pow-ext',
      'target',
      'rel',
      // YouTube embed (validated in installHooks; class kept only if 'ytembed').
      'class',
      'src',
      'title',
      'loading',
      'allow',
      'referrerpolicy',
      'allowfullscreen',
      'frameborder',
    ],
  })
}
