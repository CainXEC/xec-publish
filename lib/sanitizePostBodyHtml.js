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

/** True if HTML has non-empty visible text (for required validation). */
export function postBodyHasMeaningfulText(html) {
  if (!html || typeof html !== 'string') return false
  const text = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > 0
}

/**
 * Sanitize author HTML for safe rendering (scripts, event handlers, and unsafe styles removed).
 */
export function sanitizePostBodyHtml(dirty) {
  if (typeof dirty !== 'string') return ''
  installStyleHook()
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ['style'],
  })
}
