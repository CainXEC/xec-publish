'use client'

import Link from 'next/link'
import { usePocket } from '@/lib/pocket/store'

/**
 * The topbar "spending balance" pill. Reads the pocket store (no props); shows
 * the live balance when a pocket exists, a quiet "+ pocket" affordance when
 * the signed-in account has none, and NOTHING when signed out or the feature
 * flag is off — so with the flag off the topbar renders byte-identical to
 * today. Always links to /pocket, where the panel does the real work.
 */
export default function PocketChip() {
  const pocket = usePocket()

  if (pocket.status !== 'ready' && pocket.status !== 'none') return null

  const label =
    pocket.status === 'ready' ? `⌾ ${formatXec(pocket.balanceSats)}` : '⌾ pocket'
  const title =
    pocket.status === 'ready'
      ? 'Pocket — your spending balance'
      : 'Set up a Pocket — one-tap likes, replies and unlocks'

  return (
    <>
      <style>{CSS}</style>
      <Link
        href="/pocket"
        className={`pocketchip${pocket.status === 'none' ? ' empty' : ''}`}
        title={title}
        aria-label={title}
      >
        {label}
      </Link>
    </>
  )
}

/** sats → compact XEC label: 4,920 · 12.3K · 1.2M. Balance display only. */
function formatXec(sats) {
  if (sats == null) return '…'
  const xec = Math.floor(sats / 100)
  if (xec < 10000) return xec.toLocaleString()
  if (xec < 1_000_000) return `${(xec / 1000).toFixed(1).replace(/\.0$/, '')}K`
  return `${(xec / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}

const CSS = `
.pocketchip{
  display:inline-flex;align-items:center;gap:4px;
  font-size:12px;font-weight:700;letter-spacing:.04em;white-space:nowrap;
  color:var(--neon,#00ff9c);border:1px solid currentColor;border-radius:999px;
  padding:3px 10px;text-decoration:none;line-height:1.4;
  opacity:.92;transition:opacity .15s;
}
.pocketchip:hover{opacity:1;}
.pocketchip.empty{color:var(--dim,#5f8a7e);border-style:dashed;font-weight:500;}
html:not(.dark) .pocketchip{color:var(--neon,#12703c);}
html:not(.dark) .pocketchip.empty{color:var(--dim,#5e6155);}
`
