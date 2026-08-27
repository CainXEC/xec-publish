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
]

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
  })

  // After per-attribute sanitizing, lock down anchors: a live external link ALWAYS
  // opens in a new tab with a tab-nabbing/referrer guard (never trust author target
  // /rel), and any anchor that lost its href is stripped of the outbound + marker
  // attributes so it's cleanly inert.
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
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
    ALLOWED_ATTR: ['style', 'href', 'data-pow', 'data-pow-ext', 'target', 'rel'],
  })
}
