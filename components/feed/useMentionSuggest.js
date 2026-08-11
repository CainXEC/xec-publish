'use client'
// =============================================================================
//  useMentionSuggest.js — @handle autocomplete while typing in a textarea.
//
//  Watches the textarea's own caret (not just React's `value`, since a click or
//  arrow key can move the caret without changing the text) for an in-progress
//  "@partial" mention immediately before it, fetches matching handles (prefix
//  match, /api/mentions/suggest), and exposes what a dropdown + keyboard
//  handler need. The boundary rule for "is this an @mention start" mirrors
//  lib/contentLinks.js's MENTION_SOURCE/BOUNDARY_BEFORE, so what lights up here
//  is exactly what would later render as a live mention.
//
//  Doesn't touch the textarea's value itself — `select()` returns the
//  replacement text + where the caret should land, and the host (which already
//  owns `content` state, e.g. ComposeBox) applies it exactly like it applies an
//  emoji pick.
//
//  `recompute` is exposed for the HOST to call from its own onChange/onClick/
//  onKeyUp handlers — this hook does NOT attach its own addEventListener to the
//  textarea. It used to, and that raced React's controlled-input update on the
//  very same keystroke: a plain DOM listener on 'input' can run its setState
//  before React's own synthetic onChange has committed `content`, and the
//  reconciliation that follows can re-render the textarea with the STALE
//  `content` value — silently reverting whatever was just typed. Typing "@" as
//  literally the first character (content: '' -> '@') hit this every time;
//  "c@" mostly didn't, because content was already non-empty going into the
//  keystroke. Driving recompute from React's own handlers keeps every state
//  update inside React's normal batch, in the right order, every time.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'

const HANDLE_CHARS = 'A-Za-z0-9_'
// Boundary mirrors contentLinks.js: an '@' preceded by a handle char, another
// '@', '.', or '/' doesn't start a mention (guards emails, URLs, chained @s).
const MENTION_QUERY_RE = new RegExp(`(^|[^${HANDLE_CHARS}@./])@([${HANDLE_CHARS}]{0,15})$`)
const DEBOUNCE_MS = 150

// Computed style properties that affect text layout/wrapping — copied onto a
// hidden mirror div so it wraps text identically to the real textarea. This
// is how the dropdown anchors to the "@" itself instead of the bottom of the
// whole (possibly multi-row, empty-below-the-caret) textarea box.
const MIRROR_PROPS = [
  'boxSizing',
  'width',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'letterSpacing',
  'lineHeight',
  'textTransform',
  'wordSpacing',
  'textIndent',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'borderStyle',
]

/** Pixel offset of the character at `index`, relative to the textarea's own
 *  border-box top-left, one line below (where a dropdown should sit). */
function caretCoordinates(textarea, index) {
  const style = window.getComputedStyle(textarea)
  const mirror = document.createElement('div')
  mirror.style.position = 'absolute'
  mirror.style.visibility = 'hidden'
  mirror.style.whiteSpace = 'pre-wrap'
  mirror.style.wordWrap = 'break-word'
  mirror.style.top = '0'
  mirror.style.left = '0'
  for (const prop of MIRROR_PROPS) mirror.style[prop] = style[prop]
  document.body.appendChild(mirror)

  mirror.textContent = textarea.value.slice(0, index)
  const marker = document.createElement('span')
  marker.textContent = '​'
  mirror.appendChild(marker)

  const lineHeight = parseFloat(style.lineHeight) || marker.offsetHeight
  const top = marker.offsetTop + parseInt(style.borderTopWidth, 10) - textarea.scrollTop + lineHeight
  const left = marker.offsetLeft + parseInt(style.borderLeftWidth, 10) - textarea.scrollLeft

  document.body.removeChild(mirror)
  return { top, left }
}

export function useMentionSuggest(textareaRef, { onSelect } = {}) {
  const [query, setQuery] = useState(null) // null = no active mention context
  const [range, setRange] = useState(null) // { start, end } of "@partial" in the text
  const [items, setItems] = useState([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [coords, setCoords] = useState({ top: 0, left: 0 })
  const debounceRef = useRef(null)
  const reqIdRef = useRef(0)

  const recompute = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    const caret = el.selectionStart
    // A real (non-collapsed) selection isn't "typing a mention" — bail.
    if (el.selectionEnd !== caret) {
      setQuery(null)
      setRange(null)
      return
    }
    const before = el.value.slice(0, caret)
    const m = before.match(MENTION_QUERY_RE)
    if (!m) {
      setQuery(null)
      setRange(null)
      return
    }
    const partial = m[2]
    const start = caret - partial.length - 1
    setQuery(partial)
    setRange({ start, end: caret })
    // Anchor to the "@" itself, not the caret — so the dropdown stays put as
    // more letters are typed instead of creeping right with the query.
    setCoords(caretCoordinates(el, start))
  }, [textareaRef])

  // Fetch suggestions for the active query (debounced). Bare "@" (query === '')
  // schedules nothing — `open` below requires a non-empty query, so there's
  // nothing to clear synchronously here; any earlier fetch's timer is just
  // cancelled.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!query) {
      // Mention context closed (deleted back past "@", or a bare "@" with no
      // letters yet) — drop any stale items now, not just on the next fetch,
      // or the OLD query's results flash back open the instant a fresh
      // "@letter" starts a new mention before its own fetch resolves.
      setItems([])
      return undefined
    }
    const myReqId = ++reqIdRef.current
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/mentions/suggest?q=${encodeURIComponent(query)}`, {
          cache: 'no-store',
        })
        const data = await res.json()
        if (reqIdRef.current !== myReqId) return // a newer keystroke has since fired
        setItems(Array.isArray(data?.items) ? data.items : [])
        setActiveIndex(0)
      } catch {
        if (reqIdRef.current === myReqId) setItems([])
      }
    }, DEBOUNCE_MS)
    return () => clearTimeout(debounceRef.current)
  }, [query])

  // Boolean(query), not `query != null` — a bare "@" (query === '') must stay
  // closed even if `items` still holds a PRIOR query's results (nothing here
  // clears them synchronously; see the fetch effect above).
  const open = Boolean(query) && items.length > 0

  const close = useCallback(() => {
    setQuery(null)
    setRange(null)
    setItems([])
  }, [])

  // Replace the "@partial" span with "@handle " (trailing space, so typing
  // continues as a new word) and hand the host the new text + caret position —
  // same contract as ComposeBox's own insertEmoji.
  const select = useCallback(
    (handle) => {
      const el = textareaRef.current
      if (!el || !range) return
      const insertion = `@${handle} `
      const next = el.value.slice(0, range.start) + insertion + el.value.slice(range.end)
      const pos = range.start + insertion.length
      close()
      onSelect?.(next, pos)
    },
    [textareaRef, range, close, onSelect],
  )

  const onKeyDown = useCallback(
    (e) => {
      if (!open) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIndex((i) => (i + 1) % items.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIndex((i) => (i - 1 + items.length) % items.length)
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        const chosen = items[activeIndex]
        if (chosen) select(chosen.handle)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        close()
      }
    },
    [open, items, activeIndex, select, close],
  )

  return { items, activeIndex, setActiveIndex, open, onKeyDown, recompute, select, close, coords }
}
