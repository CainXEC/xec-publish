'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { usePocket } from '@/lib/pocket/store'

// How long a touch must be held before it jumps straight to /pocket. A shorter
// tap opens the balance card (which carries its own "Open Pocket →" button, so
// the long-press is now just a shortcut for repeat users).
const LONG_PRESS_MS = 450

/**
 * Topbar Pocket button.
 *   desktop : hover shows a balance card (with an Open button) · click opens /pocket
 *   mobile  : tap shows the balance card · its "Open Pocket →" button opens the
 *             full screen. Long-press is a shortcut.
 * The card is a SIBLING of the chip (both inside .pocketbtn-wrap), not a child —
 * a <button> can't nest another interactive element, and the whole point here is
 * a real, tappable Open button so the way in is discoverable, not a hidden gesture.
 * Renders null when there's no pocket, so it never leaves an empty slot.
 */
export default function PocketChip() {
  const pocket = usePocket()
  const router = useRouter()
  const [open, setOpen] = useState(false) // touch: balance card toggled by tap
  const rootRef = useRef(null)
  const pressTimer = useRef(null)
  const longPressed = useRef(false)
  const lastPointerType = useRef('mouse')

  const openPocket = useCallback(() => {
    setOpen(false)
    router.push('/pocket')
  }, [router])

  // Dismiss a tapped-open card when tapping elsewhere.
  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  useEffect(() => () => { if (pressTimer.current) clearTimeout(pressTimer.current) }, [])

  const status = pocket.status
  if (status !== 'ready' && status !== 'none') return null
  const hasPocket = status === 'ready'

  // Signed in but no pocket yet: nothing to preview — the chip goes straight to
  // setup. No card, no long-press.
  if (!hasPocket) {
    return (
      <div className="pocketbtn-wrap">
        <button
          type="button"
          className="pocketbtn pocketbtn-empty"
          aria-label="Set up a Pocket — one-tap likes, replies and unlocks."
          onClick={openPocket}
          onContextMenu={(e) => e.preventDefault()}
        >
          <PocketIcon />
        </button>
      </div>
    )
  }

  const handlePointerDown = (e) => {
    lastPointerType.current = e.pointerType
    if (e.pointerType === 'touch') {
      longPressed.current = false
      pressTimer.current = setTimeout(() => {
        longPressed.current = true
        openPocket()
      }, LONG_PRESS_MS)
    }
  }
  const handlePointerUp = (e) => {
    if (e.pointerType !== 'touch') return
    if (pressTimer.current) clearTimeout(pressTimer.current)
    if (!longPressed.current) {
      // Short tap: reveal/hide the balance card — its button does the navigating.
      e.preventDefault()
      setOpen((v) => !v)
    }
  }
  const handlePointerCancel = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current)
  }
  const handleClick = (e) => {
    if (e.detail === 0) { openPocket(); return } // keyboard (Enter/Space)
    if (lastPointerType.current === 'touch') { e.preventDefault(); return } // touch handled above
    openPocket() // desktop mouse click
  }

  const balanceText =
    pocket.balanceSats == null ? 'Loading…' : `${formatXec(pocket.balanceSats)} XEC`

  return (
    <div ref={rootRef} className={`pocketbtn-wrap${open ? ' open' : ''}`}>
      <button
        type="button"
        className="pocketbtn"
        aria-label={`Pocket balance ${balanceText}. Open the Pocket.`}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onClick={handleClick}
        onContextMenu={(e) => e.preventDefault()}
      >
        <PocketIcon />
      </button>
      <div className="pocket-bal">
        <span className="pocket-bal-amt" role="status" aria-live="polite">
          {balanceText}
        </span>
        <button type="button" className="pocket-open" onClick={openPocket}>
          Open Pocket →
        </button>
      </div>
    </div>
  )
}

/** A shirt pocket: flat rounded-bottom body + the flap stitch line. */
function PocketIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M5 4h14v12a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z" />
      <path d="M5 9h14" />
    </svg>
  )
}

/** sats → compact XEC label: 4,920 · 12.3K · 1.2M. */
function formatXec(sats) {
  if (sats == null) return '…'
  const xec = Math.floor(sats / 100)
  if (xec < 10000) return xec.toLocaleString()
  if (xec < 1_000_000) return `${(xec / 1000).toFixed(1).replace(/\.0$/, '')}K`
  return `${(xec / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}
