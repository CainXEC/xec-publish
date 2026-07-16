'use client'

import Link from 'next/link'
import { usePocket } from '@/lib/pocket/store'

/**
 * The topbar Pocket button — the notification bell's sibling: same 34px icon
 * chrome (.pocketbtn styles live in feedTheme.js next to .notifbtn), drawn as
 * a shirt pocket. Solid border when a pocket exists (tooltip carries the live
 * balance); dashed + dim when the signed-in account has none yet; renders
 * NOTHING when signed out or the feature flag is off — so with the flag off
 * the topbar is byte-identical to before. Always links to /pocket.
 */
export default function PocketChip() {
  const pocket = usePocket()

  if (pocket.status !== 'ready' && pocket.status !== 'none') return null

  const hasPocket = pocket.status === 'ready'
  const title = hasPocket
    ? `Pocket — ${formatXec(pocket.balanceSats)} XEC spending balance`
    : 'Set up a Pocket — one-tap likes, replies and unlocks'

  return (
    <Link
      href="/pocket"
      className={`pocketbtn${hasPocket ? '' : ' pocketbtn-empty'}`}
      title={title}
      aria-label={title}
    >
      <PocketIcon />
    </Link>
  )
}

/** A shirt pocket: pentagon body with a pointed hem + the flap stitch line. */
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
      <path d="M5 4h14v9l-7 7-7-7z" />
      <path d="M5 9h14" />
    </svg>
  )
}

/** sats → compact XEC label for the tooltip: 4,920 · 12.3K · 1.2M. */
function formatXec(sats) {
  if (sats == null) return '…'
  const xec = Math.floor(sats / 100)
  if (xec < 10000) return xec.toLocaleString()
  if (xec < 1_000_000) return `${(xec / 1000).toFixed(1).replace(/\.0$/, '')}K`
  return `${(xec / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}
