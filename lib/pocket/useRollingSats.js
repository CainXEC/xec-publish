import { useEffect, useRef, useState } from 'react'

// How long a balance flourish stays up after a change before reverting — SHARED
// by the two surfaces that flash on a balance move (the Pocket chip's card and
// the wordmark's balance takeover) so they hold for the same beat and revert
// together. Keep them driven off this one value, never separate literals.
export const BALANCE_FLASH_HOLD_MS = 1800

/**
 * Tween a sats value toward `target` (ease-out cubic, ~650ms) so a Pocket balance
 * ROLLS to its new value like the newer Cashtab wallet — down on a spend, up on a
 * top-up — instead of snapping. First paint and reduced-motion jump straight to
 * the value; only a real change rolls. Shared by the topbar chip and the /pocket
 * panel so they animate identically.
 */
export function useRollingSats(target) {
  const [display, setDisplay] = useState(target)
  const prevRef = useRef(target)
  useEffect(() => {
    const from = prevRef.current
    prevRef.current = target
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    if (target == null || from == null || from === target || reduce) {
      setDisplay(target)
      return undefined
    }
    const start = performance.now()
    const DUR = 650
    let raf = 0
    const tick = (now) => {
      const t = Math.min(1, (now - start) / DUR)
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplay(Math.round(from + (target - from) * eased))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target])
  return display
}
