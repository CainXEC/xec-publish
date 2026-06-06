import DOMPurify from 'isomorphic-dompurify'

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
]

let hooksInstalled = false

function installStyleHook() {
  if (hooksInstalled) return
  if (typeof DOMPurify.addHook !== 'function') return
  hooksInstalled = true
  DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
    if (data.attrName !== 'style' || !data.attrValue) return
    const v = data.attrValue.replace(/\s+/g, ' ').trim()
    if (!/^text-align:\s*(left|center|right)\s*(;)?$/i.test(v)) {
      data.keepAttr = false
    }
  })
}

/**
 * Sanitize author HTML (scripts, event handlers, and unsafe styles removed).
 * Uses the same allowlist in Node (SSR) and the browser.
 */
export function sanitizePostBodyHtml(dirty) {
  if (typeof dirty !== 'string') return ''
  if (DOMPurify.isSupported === false) return ''
  installStyleHook()
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ['style'],
  })
}
