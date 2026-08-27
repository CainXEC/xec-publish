// =============================================================================
//  selectionGuard — distinguish "tapped a card" from "highlighted its text".
//
//  Feed posts (and thread ancestor rows) open their thread on a click anywhere
//  on the card. But dragging to SELECT text ends in a click too, so selecting a
//  post's text to copy it would navigate away. Click-to-open handlers call these
//  and bail when the click is really the tail of a selection/drag.
//
//  Two cases:
//   • isSelectingWithin — a live DOM selection anchored inside the clicked card
//     (e.g. double-click-select a word, then the click). getSelection()-based.
//   • wasDrag — the click is the END of a pointer DRAG, or a gesture that began
//     inside a text field. This is what catches selecting text in a reply/quote
//     COMPOSE box (a <textarea>, whose selection getSelection() can't see) and
//     releasing over another post: without it the post opens and the inline
//     composer unmounts, losing the draft. Tracked via a capture-phase pointer-
//     down listener so it works no matter WHERE the drag started.
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

// Last pointer-down: where it landed and whether it began in an editable field.
let _down = null

function recordDown(x, y, target) {
  const editable =
    target && typeof target.closest === 'function'
      ? Boolean(target.closest('textarea, input, [contenteditable="true"], [contenteditable=""]'))
      : false
  _down = { x, y, editable }
}

if (typeof window !== 'undefined') {
  // Capture phase so it runs before any handler that might stopPropagation.
  window.addEventListener(
    'mousedown',
    (e) => recordDown(e.clientX, e.clientY, e.target),
    true,
  )
  window.addEventListener(
    'touchstart',
    (e) => {
      const t = e.touches && e.touches[0]
      if (t) recordDown(t.clientX, t.clientY, e.target)
    },
    { capture: true, passive: true },
  )
}

/**
 * True when a click should NOT be treated as a tap-to-open: it's the tail of a
 * pointer DRAG (moved more than `threshold` px since pointer-down), OR the gesture
 * began inside a text field — i.e. you were selecting a draft in a compose box and
 * released over a card. `e` is the click event.
 */
export function wasDrag(e, threshold = 8) {
  if (typeof window === 'undefined' || !_down) return false
  if (_down.editable) return true
  const x = e?.clientX ?? e?.changedTouches?.[0]?.clientX
  const y = e?.clientY ?? e?.changedTouches?.[0]?.clientY
  if (x == null || y == null) return false
  return Math.hypot(x - _down.x, y - _down.y) > threshold
}
