'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { usePocket } from '@/lib/pocket/store'

// How long a touch must be held before it opens the Pocket page. A shorter tap
// just reveals the balance.
const LONG_PRESS_MS = 450

/**
 * Topbar Pocket button.
 *   desktop : hover reveals the balance · click opens /pocket
 *   mobile  : tap reveals the balance · long-press opens /pocket
 * The reveal is CSS — `:hover` on hover-capable devices, a toggled `.open`
 * class on touch (see .pocket-bal in feedTheme). Renders null when there's no
 * pocket, so it never leaves an empty slot.
 */
export default function PocketChip() {
  const pocket = usePocket()
  const router = useRouter()
  const [open, setOpen] = useState(false) // touch: balance popover toggled by tap
  const rootRef = useRef(null)
  const pressTimer = useRef(null)
  const longPressed = useRef(false)
  const lastPointerType = useRef('mouse')

  const openPocket = useCallback(() => {
    setOpen(false)
    router.push('/pocket')
  }, [router])

  // Dismiss a tapped-open balance when tapping elsewhere.
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
      // Short tap: reveal/hide the balance — don't navigate.
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

  const balanceText = hasPocket
    ? pocket.balanceSats == null
      ? 'Loading…'
      : `${formatXec(pocket.balanceSats)} XEC`
    : 'Set up your Pocket'
  const ariaLabel = hasPocket
    ? `Pocket balance ${balanceText}. Open the Pocket.`
    : 'Set up a Pocket — one-tap likes, replies and unlocks.'

  return (
    <button
      type="button"
      ref={rootRef}
      className={`pocketbtn${hasPocket ? '' : ' pocketbtn-empty'}${open ? ' open' : ''}`}
      aria-label={ariaLabel}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onClick={handleClick}
      onContextMenu={(e) => e.preventDefault()}
    >
      <PocketIcon />
      <span className="pocket-bal" role="status" aria-live="polite">
        {balanceText}
      </span>
    </button>
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
