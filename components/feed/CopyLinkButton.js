'use client'
// =============================================================================
//  CopyLinkButton.js — the reading panes' share affordance.
//
//  The pane deliberately never touches the address bar, so the story/thread
//  being read has no visible URL. The actual user need is "give me the
//  link" — so give exactly that: one tap puts the canonical URL on the
//  clipboard without leaving what you're reading. (Power users who really
//  want the full page can cmd/middle-click any headline.)
// =============================================================================

import { useEffect, useRef, useState } from 'react'

export default function CopyLinkButton({ path }) {
  const [state, setState] = useState('idle') // idle | copied | failed
  const timerRef = useRef(null)

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  const copy = async () => {
    const url = `${window.location.origin}${path}`
    try {
      await navigator.clipboard.writeText(url)
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
      className={`hr-open${state === 'copied' ? ' copied' : ''}`}
      onClick={() => void copy()}
    >
      {state === 'copied' ? 'Copied ✓' : state === 'failed' ? "Couldn't copy" : 'Copy link'}
    </button>
  )
}
