import DOMPurify from 'isomorphic-dompurify'
import { powInternalHref } from './contentLinks'

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
    // Anchors only survive as LINKS when they carry our publish-time marker AND
    // resolve to an on-site live path (article / feed post / profile). Anything
    // else loses its href and renders as inert text — so a pasted external link,
    // or a stale pre-policy anchor, can never become clickable at read time.
    if (data.attrName === 'href') {
      const normalized =
        node.getAttribute?.('data-pow') != null ? powInternalHref(data.attrValue) : null
      if (!normalized) {
        data.keepAttr = false
        return
      }
      data.attrValue = normalized
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
    ALLOWED_ATTR: ['style', 'href', 'data-pow'],
  })
}
