/**
 * Server-only HTML sanitization for post bodies (uses jsdom via isomorphic-dompurify).
 * Do not import from client components.
 */
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
  hooksInstalled = true
  DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
    if (data.attrName !== 'style' || !data.attrValue) return
    const v = data.attrValue.replace(/\s+/g, ' ').trim()
    if (!/^text-align:\s*(left|center|right)\s*(;)?$/i.test(v)) {
      data.keepAttr = false
    }
  })
}

export function sanitizePostBodyHtmlServer(dirty) {
  if (typeof dirty !== 'string') return ''
  installStyleHook()
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ['style'],
  })
}
