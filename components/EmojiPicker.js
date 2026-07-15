'use client'
// =============================================================================
//  EmojiPicker.js — a small, dependency-free emoji picker.
//
//  Renders a trigger button; clicking it opens a themed popover with a search
//  box and a scrollable grid of native Unicode emoji (lib/emojiData.js). On
//  pick it calls onPick(char) and closes — the HOST decides where the character
//  goes (splice at a textarea caret, or editor.insertContent for Tiptap). It
//  carries no state about the target, so the same component serves the feed
//  composer, the comment composer, and the article editor toolbar.
//
//  Styling lives in globals.css (.emojipick-*) and reads the scoped theme vars
//  (--panel/--line/--text/--neon) with fallbacks, so it adapts to the feed,
//  article, and paper/dark themes without per-host CSS.
// =============================================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import { EMOJI_CATEGORIES, EMOJI_FLAT } from '@/lib/emojiData'

export default function EmojiPicker({
  onPick,
  triggerClassName = '',
  triggerLabel = '😊',
  title = 'Insert emoji',
  align = 'left',
  direction = 'up',
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  // Which way the popover opens. `direction` is the initial hint; on open we
  // measure the trigger and flip to whichever side has room, so it never clips
  // whether the composer sits at the top of the feed or a reply sits low.
  const [place, setPlace] = useState(direction)
  const rootRef = useRef(null)
  const triggerRef = useRef(null)
  const searchRef = useRef(null)

  // Auto-place on open: prefer the side (above/below the trigger) with more room.
  useEffect(() => {
    if (!open) return
    const el = triggerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    const spaceAbove = rect.top
    setPlace(spaceBelow >= spaceAbove ? 'down' : 'up')
  }, [open])

  // Close on outside click or Escape — standard popover dismissal.
  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Focus the search box when the popover opens so you can type straight away.
  useEffect(() => {
    if (open) searchRef.current?.focus()
  }, [open])

  const q = query.trim().toLowerCase()
  const results = useMemo(
    () => (q ? EMOJI_FLAT.filter((it) => it.n.includes(q)) : null),
    [q],
  )

  const choose = (char) => {
    onPick?.(char)
    // Keep the picker open so several emoji can be added in a row; clear the
    // search back to the full set for the next pick.
    setQuery('')
  }

  return (
    <div className="emojipick" ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className={`emojipick-trigger ${triggerClassName}`}
        aria-label={title}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={title}
        // mousedown-preventDefault keeps the composer/editor selection intact
        // while the popover opens (so caret-splice / insertContent land right).
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
      >
        {triggerLabel}
      </button>

      {open ? (
        <div
          className={`emojipick-pop emojipick-pop-${align} emojipick-dir-${place}`}
          role="dialog"
          aria-label="Emoji picker"
        >
          <input
            ref={searchRef}
            className="emojipick-search"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search emoji"
            spellCheck={false}
            autoComplete="off"
          />
          <div className="emojipick-scroll">
            {results ? (
              results.length === 0 ? (
                <p className="emojipick-empty">No emoji for “{query.trim()}”.</p>
              ) : (
                <div className="emojipick-grid">
                  {results.map((it) => (
                    <button
                      key={it.c}
                      type="button"
                      className="emojipick-em"
                      title={it.n}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => choose(it.c)}
                    >
                      {it.c}
                    </button>
                  ))}
                </div>
              )
            ) : (
              EMOJI_CATEGORIES.map((cat) => (
                <div key={cat.id} className="emojipick-cat">
                  <p className="emojipick-cat-label">{cat.label}</p>
                  <div className="emojipick-grid">
                    {cat.items.map((it) => (
                      <button
                        key={it.c}
                        type="button"
                        className="emojipick-em"
                        title={it.n}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => choose(it.c)}
                      >
                        {it.c}
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
