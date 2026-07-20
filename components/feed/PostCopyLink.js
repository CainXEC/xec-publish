'use client'
// =============================================================================
//  PostCopyLink.js — per-post share affordance, mirroring the article page's
//  "Copy Link". A post's permalink is its txid URL, but the feed rarely puts
//  that in the address bar (panes, in-place threads), so give the link
//  directly: one tap, no navigation away from what you're reading.
//
//  Lives top-right of the post's meta row, to the LEFT of the "+" (follow /
//  block) menu when that menu is showing.
// =============================================================================

import { useEffect, useRef, useState } from 'react'

export default function PostCopyLink({ txid }) {
  // idle | copied | failed — the button is icon-only, so a denied clipboard
  // (permissions, insecure context) has to say so rather than look inert.
  const [state, setState] = useState('idle')
  const timerRef = useRef(null)

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  if (!txid) return null

  const copy = async (e) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/feed/${txid}`)
      setState('copied')
    } catch {
      setState('failed')
    }
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setState('idle'), 1600)
  }

  return (
    <button
      type="button"
      className={`postcopy${state === 'idle' ? '' : ` ${state}`}`}
      onClick={(e) => void copy(e)}
      aria-label="Copy link to post"
      title={state === 'failed' ? "Couldn't copy" : 'Copy link'}
    >
      {state !== 'idle' ? (
        <span className="postcopy-ok" aria-hidden>
          {state === 'copied' ? '✓' : '✕'}
        </span>
      ) : (
        <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden focusable="false">
          <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M10 13.5a4 4 0 0 0 5.7.3l3-3a4 4 0 0 0-5.7-5.7l-1.3 1.3" />
            <path d="M14 10.5a4 4 0 0 0-5.7-.3l-3 3a4 4 0 0 0 5.7 5.7l1.3-1.3" />
          </g>
        </svg>
      )}
    </button>
  )
}
