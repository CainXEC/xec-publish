// =============================================================================
//  searchSnippet.js — parse the ts_headline highlight markers search_site()
//  emits (StartSel=⟦ StopSel=⟧, see sql/search.sql) into renderable segments.
//  The UI maps { mark: true } segments to <mark> elements, so highlighted
//  snippets never round-trip through HTML — headline text stays plain text.
// =============================================================================

export const SNIPPET_START = '⟦'
export const SNIPPET_END = '⟧'

/**
 * Split a headline string into ordered segments.
 * "a ⟦b⟧ c" -> [{text:'a ',mark:false},{text:'b',mark:true},{text:' c',mark:false}]
 * Unbalanced markers degrade gracefully: a ⟦ with no closer marks the rest of
 * the string; stray ⟧ are treated as literal text.
 * @param {string} snippet
 * @returns {Array<{ text: string, mark: boolean }>}
 */
export function parseSnippetSegments(snippet) {
  const src = typeof snippet === 'string' ? snippet : ''
  if (!src) return []
  const segments = []
  let rest = src
  while (rest.length > 0) {
    const open = rest.indexOf(SNIPPET_START)
    if (open === -1) {
      segments.push({ text: rest, mark: false })
      break
    }
    if (open > 0) segments.push({ text: rest.slice(0, open), mark: false })
    const afterOpen = rest.slice(open + SNIPPET_START.length)
    const close = afterOpen.indexOf(SNIPPET_END)
    if (close === -1) {
      if (afterOpen) segments.push({ text: afterOpen, mark: true })
      break
    }
    if (close > 0) segments.push({ text: afterOpen.slice(0, close), mark: true })
    rest = afterOpen.slice(close + SNIPPET_END.length)
  }
  return segments.filter((s) => s.text.length > 0)
}
