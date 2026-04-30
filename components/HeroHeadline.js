'use client'

import { useState, useEffect, useRef } from 'react'

const FULL_TEXT = 'Write to earn. Use eCash to unlock your story.'
const BREAK_PREFIX = 'Write to earn. Use eCash'
const breakIndex = BREAK_PREFIX.length
const CH_MS = 75
const POST_TYPE_CURSOR_MS = 3000

const heroAria =
  'Write to earn. Use eCash to unlock your story.'

const headingClass =
  'mx-auto max-w-none text-[clamp(1.625rem,8vw,2.25rem)] text-zinc-900 sm:text-[clamp(2rem,5vw,3.25rem)] dark:text-zinc-50'

/**
 * Invisible static layer reserves final two-line height; typing renders in a matching absolutely positioned h1.
 */
export default function HeroHeadline({ wordmarkStyle, align = 'center' }) {
  const [typed, setTyped] = useState('')
  const [showCursor, setShowCursor] = useState(true)
  const cursorTimeoutRef = useRef(/** @type {ReturnType<typeof setTimeout> | null} */ (null))

  useEffect(() => {
    let cancelled = false
    const pendingRef = { id: /** @type {ReturnType<typeof setTimeout> | null} */ (null) }

    let i = 0
    const tick = () => {
      if (cancelled) return
      i += 1
      setTyped(FULL_TEXT.slice(0, i))
      if (i >= FULL_TEXT.length) {
        cursorTimeoutRef.current = window.setTimeout(() => {
          setShowCursor(false)
        }, POST_TYPE_CURSOR_MS)
        return
      }
      const lastChar = FULL_TEXT[i - 1]
      let nextDelay = CH_MS
      if (lastChar === '.') {
        nextDelay = 600
      } else if (lastChar === ',' || lastChar === ';') {
        nextDelay = 200
      }
      pendingRef.id = window.setTimeout(tick, nextDelay)
    }

    pendingRef.id = window.setTimeout(tick, CH_MS)

    return () => {
      cancelled = true
      if (pendingRef.id) {
        clearTimeout(pendingRef.id)
        pendingRef.id = null
      }
      if (cursorTimeoutRef.current) {
        clearTimeout(cursorTimeoutRef.current)
        cursorTimeoutRef.current = null
      }
    }
  }, [])

  const beforeBreak = typed.slice(0, breakIndex)
  const afterBreak = typed.slice(breakIndex)
  const showLineBreak = typed.length > breakIndex

  const alignClass = align === 'left' ? 'text-left' : 'text-center'

  return (
    <div className={`relative mx-auto w-full ${alignClass}`}>
      <div
        className={`invisible w-full min-h-0 select-none ${alignClass} ${headingClass}`}
        style={wordmarkStyle}
        aria-hidden="true"
      >
        <span className="whitespace-nowrap">Write to earn. Use eCash</span>
        <br />
        <span> to unlock your story.</span>
      </div>
      <h1
        className={`absolute top-0 left-0 right-0 z-10 w-full min-h-0 ${alignClass} ${headingClass}`}
        id="home-hero-heading"
        style={{ ...wordmarkStyle, visibility: 'visible' }}
        aria-label={heroAria}
      >
        <span className="whitespace-nowrap" aria-hidden="true">
          {beforeBreak}
        </span>
        {showLineBreak ? <br /> : null}
        <span aria-hidden="true">{afterBreak}</span>
        <span
          className={`-mb-0.5 ml-0.5 inline-block w-[0.2em] min-w-[0.1em] translate-y-px text-current ${showCursor ? 'animate-blink' : ''}`}
          style={{ visibility: showCursor ? 'visible' : 'hidden' }}
          aria-hidden="true"
        >
          |
        </span>
      </h1>
    </div>
  )
}
