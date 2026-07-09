// =============================================================================
//  articleBodyLinks.js — publish-time link policy for ARTICLE bodies (Node only).
//
//  Applied in savePost so the policy is baked into stored HTML at write time.
//  This is deliberate: it makes the behavior "new content only" — existing
//  articles keep whatever HTML they already have and are never re-linkified — and
//  it lets the render-time sanitizer (lib/sanitizePostBodyHtml) trust a single
//  marker (`data-pow`) instead of re-classifying every href on every read.
//
//  Two passes over the body:
//    1. Every <a> is classified via powInternalHref(). Live on-site links become
//       a clean, marked anchor `<a data-pow href="/normalized/path">`; every
//       other anchor (external, javascript:, mailto:, …) is UNWRAPPED to its text
//       so the link is inert but the words remain.
//    2. @handle mentions in the remaining text (never inside an existing anchor)
//       are wrapped in `<a data-pow href="/@handle">`.
//
//  Idempotent: re-saving already-transformed HTML keeps the marked anchors and
//  skips mentions already inside an <a>.
// =============================================================================

import { JSDOM } from 'jsdom'
import { powInternalHref, tokenizeMentions } from './contentLinks'

export function transformArticleBodyLinks(html) {
  const src = typeof html === 'string' ? html : ''
  if (!src.trim()) return src

  const dom = new JSDOM(`<body>${src}</body>`)
  const { document: doc } = dom.window
  const root = doc.body

  // Pass 1: anchor policy.
  for (const a of [...root.querySelectorAll('a')]) {
    const internal = powInternalHref(a.getAttribute('href'))
    if (internal) {
      for (const attr of [...a.attributes]) a.removeAttribute(attr.name)
      a.setAttribute('href', internal)
      a.setAttribute('data-pow', '')
    } else {
      a.replaceWith(doc.createTextNode(a.textContent || ''))
    }
  }

  // Pass 2: @handle mentions in bare text nodes.
  linkifyMentions(doc, root)

  return root.innerHTML
}

function linkifyMentions(doc, root) {
  const { NodeFilter } = doc.defaultView
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const targets = []
  while (walker.nextNode()) {
    const node = walker.currentNode
    // Skip text already inside an anchor (a marked link, or a mention we just made).
    if (node.parentElement?.closest('a')) continue
    if (/@[A-Za-z0-9_]/.test(node.nodeValue || '')) targets.push(node)
  }
  for (const node of targets) {
    const tokens = tokenizeMentions(node.nodeValue)
    if (!tokens.some((t) => t.type === 'mention')) continue
    const frag = doc.createDocumentFragment()
    for (const t of tokens) {
      if (t.type === 'mention') {
        const a = doc.createElement('a')
        a.setAttribute('href', `/@${t.handle}`)
        a.setAttribute('data-pow', '')
        a.textContent = t.value
        frag.appendChild(a)
      } else {
        frag.appendChild(doc.createTextNode(t.value))
      }
    }
    node.replaceWith(frag)
  }
}
