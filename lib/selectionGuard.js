// =============================================================================
//  selectionGuard — distinguish "tapped a card" from "highlighted its text".
//
//  Feed posts (and thread ancestor rows) open their thread on a click anywhere
//  on the card. But dragging to SELECT text ends in a click too, so selecting a
//  post's text to copy it would navigate away. Click-to-open handlers call this
//  and bail when the user has a live text selection inside the clicked element.
// =============================================================================

/** True when there's a non-empty text selection anchored inside `el`. */
export function isSelectingWithin(el) {
  if (typeof window === 'undefined' || !el) return false
  const sel = window.getSelection()
  return Boolean(
    sel &&
      !sel.isCollapsed &&
      sel.toString().trim() &&
      sel.anchorNode &&
      el.contains(sel.anchorNode),
  )
}
