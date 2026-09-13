'use client'

import { useEffect, useState } from 'react'

/**
 * True when the primary pointer can hover (a desktop mouse / trackpad), false on
 * a touch phone. Use it to gate JS hover handlers (onMouseEnter/Leave): on touch,
 * a single tap fires an EMULATED mouseenter right before the click, so a handler
 * that opens on mouseenter and toggles on click cancels itself out — the first
 * tap nets to closed and you have to tap again. Gating the mouse handlers off
 * when !canHover lets the tap go straight through onClick.
 *
 * Defaults to true so the server render and the first client render agree (no
 * hydration mismatch); it's corrected on mount, before any interaction can
 * happen, and stays live if the pointer capability changes (e.g. a mouse is
 * plugged into a tablet).
 */
export function useCanHover() {
  const [canHover, setCanHover] = useState(true)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined
    const mq = window.matchMedia('(hover: hover)')
    const sync = () => setCanHover(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])
  return canHover
}
