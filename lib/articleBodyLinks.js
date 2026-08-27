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
import { powInternalHref, externalUrlHref, tokenizeContent } from './contentLinks'

// A live external anchor (X/Twitter or e.cash) is marked distinctly and always
// opens in a new tab with a tab-nabbing/leak guard. The read-time sanitizer
// (lib/sanitizePostBodyHtml) re-validates the marker + href and re-forces these.
function setExternalAnchor(a, href) {
  a.setAttribute('href', href)
  a.setAttribute('data-pow-ext', '')
  a.setAttribute('target', '_blank')
  a.setAttribute('rel', 'noopener noreferrer nofollow')
}

export function transformArticleBodyLinks(html) {
  const src = typeof html === 'string' ? html : ''
  if (!src.trim()) return src

  const dom = new JSDOM(`<body>${src}</body>`)
  const { document: doc } = dom.window
  const root = doc.body

  // Pass 1: anchor policy — on-site (data-pow), allowed external (data-pow-ext,
  // new tab), else unwrap to inert text.
  for (const a of [...root.querySelectorAll('a')]) {
    const raw = a.getAttribute('href')
    const internal = powInternalHref(raw)
    if (internal) {
      for (const attr of [...a.attributes]) a.removeAttribute(attr.name)
      a.setAttribute('href', internal)
      a.setAttribute('data-pow', '')
      continue
    }
    const external = externalUrlHref(raw)
    if (external) {
      for (const attr of [...a.attributes]) a.removeAttribute(attr.name)
      setExternalAnchor(a, external)
      continue
    }
    a.replaceWith(doc.createTextNode(a.textContent || ''))
  }

  // Pass 2: linkify the SAME set the feed does in bare text nodes — @handle
  // mentions, on-site URLs, and allowed external (X / e.cash) URLs.
  linkifyText(doc, root)

  return root.innerHTML
}

function linkifyText(doc, root) {
  const { NodeFilter } = doc.defaultView
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const targets = []
  while (walker.nextNode()) {
    const node = walker.currentNode
    // Skip text already inside an anchor (a marked link, or one we just made).
    if (node.parentElement?.closest('a')) continue
    const v = node.nodeValue || ''
    // Cheap pre-filter: only tokenize nodes that could carry a mention or URL.
    if (/@[A-Za-z0-9_]/.test(v) || /https?:\/\//i.test(v)) targets.push(node)
  }
  for (const node of targets) {
    const tokens = tokenizeContent(node.nodeValue)
    const hasLink = tokens.some(
      (t) => t.type === 'mention' || t.type === 'link' || t.type === 'extlink',
    )
    if (!hasLink) continue
    const frag = doc.createDocumentFragment()
    for (const t of tokens) {
      if (t.type === 'mention' || t.type === 'link') {
        const a = doc.createElement('a')
        a.setAttribute('href', t.type === 'mention' ? `/@${t.handle}` : t.href)
        a.setAttribute('data-pow', '')
        a.textContent = t.value
        frag.appendChild(a)
      } else if (t.type === 'extlink') {
        const a = doc.createElement('a')
        setExternalAnchor(a, t.href)
        a.textContent = t.value
        frag.appendChild(a)
      } else {
        frag.appendChild(doc.createTextNode(t.value))
      }
    }
    node.replaceWith(frag)
  }
}
