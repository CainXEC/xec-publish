'use client'

import { useLayoutEffect, useState, useEffect, useRef } from 'react'

const SESSION_KEY = 'hero-typed'

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
export default function HeroHeadline({ wordmarkStyle }) {
  const [typed, setTyped] = useState('')
  const [showCursor, setShowCursor] = useState(true)
  const cursorTimeoutRef = useRef(/** @type {ReturnType<typeof setTimeout> | null} */ (null))

  useLayoutEffect(() => {
    if (typeof window === 'undefined') return
    try {
      if (window.sessionStorage.getItem(SESSION_KEY) === 'true') {
        setTyped(FULL_TEXT)
        setShowCursor(false)
      }
    } catch {
      /* sessionStorage can throw in edge cases */
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      if (window.sessionStorage.getItem(SESSION_KEY) === 'true') {
        return
      }
    } catch {
      return
    }

    let i = 0
    const id = window.setInterval(() => {
      i += 1
      setTyped(FULL_TEXT.slice(0, i))
      if (i >= FULL_TEXT.length) {
        window.clearInterval(id)
        try {
          window.sessionStorage.setItem(SESSION_KEY, 'true')
        } catch {
          /* ignore */
        }
        cursorTimeoutRef.current = window.setTimeout(() => {
          setShowCursor(false)
        }, POST_TYPE_CURSOR_MS)
      }
    }, CH_MS)

    return () => {
      window.clearInterval(id)
      if (cursorTimeoutRef.current) {
        clearTimeout(cursorTimeoutRef.current)
        cursorTimeoutRef.current = null
      }
    }
  }, [])

  const beforeBreak = typed.slice(0, breakIndex)
  const afterBreak = typed.slice(breakIndex)
  const showLineBreak = typed.length > breakIndex

  return (
    <div className="relative mx-auto w-full text-center">
      <div
        className={`invisible w-full min-h-0 select-none text-center ${headingClass}`}
        style={wordmarkStyle}
        aria-hidden="true"
      >
        <span className="whitespace-nowrap">Write to earn. Use eCash</span>
        <br />
        <span> to unlock your story.</span>
      </div>
      <h1
        className={`absolute top-0 left-0 w-full min-h-0 text-center ${headingClass}`}
        id="home-hero-heading"
        style={wordmarkStyle}
        aria-label={heroAria}
      >
        <span className="whitespace-nowrap" aria-hidden="true">
          {beforeBreak}
        </span>
        {showLineBreak ? <br /> : null}
        <span aria-hidden="true">{afterBreak}</span>
        {showCursor ? (
          <span
            className="animate-blink -mb-0.5 ml-0.5 inline-block w-[0.2em] min-w-[0.1em] translate-y-px text-current"
            aria-hidden
          >
            |
          </span>
        ) : null}
      </h1>
    </div>
  )
}
