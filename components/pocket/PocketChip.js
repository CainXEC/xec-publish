'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { usePocket } from '@/lib/pocket/store'
import { useRollingSats } from '@/lib/pocket/useRollingSats'

// How long a touch must be held before it jumps straight to /pocket. A shorter
// tap opens the balance card (which carries its own "Open Pocket →" button, so
// the long-press is now just a shortcut for repeat users).
const LONG_PRESS_MS = 450

// How long the no-Pocket beckon runs (CSS: .2s delay + 2.6s animation).
const BECKON_MS = 3000

// Plays once per full page load — the masthead's contract (see AnimatedLogo).
// A MODULE-level flag, not sessionStorage: a real load re-evaluates the module
// and replays the entrance, while in-app navigations that remount the chip
// (FeedTopbar is rendered per page, not in a persistent layout) reuse the loaded
// module and skip it.
let hasBeckonedThisLoad = false

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

  // Roll the balance toward its new value, and flash the card open for a beat on
  // every spend — so a pocket-paid action reads as "money moved" even when the
  // card is closed. Both honor reduced-motion (instant, no flash).
  const rollingSats = useRollingSats(pocket.balanceSats)
  const [flash, setFlash] = useState(false)
  const pulseRef = useRef(pocket.spendPulse)
  useEffect(() => {
    if (pocket.spendPulse === pulseRef.current) return undefined
    pulseRef.current = pocket.spendPulse
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return undefined
    setFlash(true)
    const id = setTimeout(() => setFlash(false), 1800)
    return () => clearTimeout(id)
  }, [pocket.spendPulse])

  // No Pocket yet → the chip beckons: a few soft beats, then it settles into its
  // steady neon state (the CSS keeps the glow either way). Same contract as the
  // masthead: once per full page load, and re-struck on every light/dark flip.
  const [beckon, setBeckon] = useState(false)
  // Bumped per strike; it keys the button, so a remount restarts the CSS
  // animation from its 0% frame — synchronous and reliable on every engine,
  // unlike class-toggle + reflow (the masthead remounts its letters for the
  // same reason).
  const [beckonGen, setBeckonGen] = useState(0)
  const reducedMotion = useRef(false)

  // Track the reduced-motion preference live; if it flips on mid-run, stop.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => {
      reducedMotion.current = mq.matches
      if (mq.matches) setBeckon(false)
    }
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  // Strike on mount, gated to once per full page load by the module flag.
  useEffect(() => {
    if (pocket.status !== 'none' || reducedMotion.current) return
    if (hasBeckonedThisLoad) return
    hasBeckonedThisLoad = true
    setBeckon(true)
    setBeckonGen((g) => g + 1)
  }, [pocket.status])

  // Re-strike on every theme flip, watching the root class the toggle writes —
  // the masthead does exactly this (a finished animation won't restart on its
  // own on mobile Safari/Chrome, so it has to be driven explicitly).
  useEffect(() => {
    if (pocket.status !== 'none') return undefined
    const root = document.documentElement
    let wasDark = root.classList.contains('dark')
    const obs = new MutationObserver(() => {
      const isDark = root.classList.contains('dark')
      if (isDark === wasDark) return // some other class changed
      wasDark = isDark
      if (reducedMotion.current) return
      setBeckon(true)
      setBeckonGen((g) => g + 1)
    })
    obs.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [pocket.status])

  // Drop the class once a strike has played out, so the next one is a clean run.
  useEffect(() => {
    if (!beckon) return undefined
    const id = setTimeout(() => setBeckon(false), BECKON_MS)
    return () => clearTimeout(id)
  }, [beckon, beckonGen])

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
          key={beckonGen}
          className={`pocketbtn pocketbtn-empty${beckon ? ' beckon' : ''}`}
          aria-label="Set up a Pocket — one-tap likes, replies and unlocks."
          onClick={openPocket}
          onContextMenu={(e) => e.preventDefault()}
        >
          <PocketIcon />
        </button>
        {/* Desktop hover nudge — CSS reveals it only on hover-capable devices. */}
        <span className="pocket-tip" role="tooltip">Load your Pocket once and pay instantly</span>
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
    rollingSats == null ? 'Loading…' : `${formatXec(rollingSats)} XEC`

  return (
    <div
      ref={rootRef}
      className={`pocketbtn-wrap${open ? ' open' : ''}${flash ? ' flash' : ''}`}
    >
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

/** sats → the FULL whole-XEC balance with thousands separators: 4,920 · 12,340 ·
 *  1,234,567. Never abbreviated (no 12.3K) and never decimal — so a 100-XEC spend
 *  is always a visible digit change and the roll animation has something to show,
 *  even on a five-figure balance. Matches the /pocket panel's formatXecFull. */
function formatXec(sats) {
  if (sats == null) return '…'
  return Math.floor(sats / 100).toLocaleString()
}

