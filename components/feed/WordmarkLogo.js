'use client'

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Bebas_Neue } from 'next/font/google'
import AnimatedLogo from '@/components/AnimatedLogo'
import { useSelfBalanceSats } from '@/lib/useSelfBalanceSats'
import { useRollingSats, BALANCE_FLASH_HOLD_MS } from '@/lib/pocket/useRollingSats'

// Same face as the sign, so the number that swaps in reads as part of the mark
// (next/font dedupes an identical config, so this shares the sign's font files).
const bebas = Bebas_Neue({ weight: '400', subsets: ['latin'], display: 'swap', variable: '--pow-logo-font' })

// How long the balance stays up after a trigger before the sign returns — shared
// with the Pocket chip's flash so the two revert together.
const HOLD_MS = BALANCE_FLASH_HOLD_MS

// Ignore a follow-up balance change within this window of the last flash. A
// Pocket spend YOU make drops the balance optimistically by the amount sent, but
// omits the network fee; ~1-2s later Chronik reconciles to the real (slightly
// lower) balance — a second change that would otherwise flash the sign again.
// One flash per action: this window must clear that reconciliation lag. An
// inbound payment is a single change and is unaffected. Kept just past the hold
// so the number the flash settles on is the reconciled one. Only gates the
// AUTOMATIC (balance-change) path — a deliberate hover/tap always flashes.
const RETRIGGER_DEBOUNCE_MS = HOLD_MS + 600

/** sats → whole-XEC with thousands separators (matches the Pocket chip: never
 *  abbreviated, so even a 100-XEC move is a visible digit change to roll). */
function formatXec(sats) {
  return Math.floor(sats / 100).toLocaleString()
}

/**
 * The masthead wordmark, doubling as a live balance readout. It cross-fades the
 * neon sign to the viewer's total spendable XEC (main wallet + Pocket) and back,
 * on three triggers:
 *   - the balance CHANGES (auto) — respects reduced-motion + a debounce so one
 *     action is one flash;
 *   - the banner is HOVERED (desktop) or TAPPED (mobile) — driven from FeedTopbar
 *     via the imperative `flash()` handle, a deliberate reveal that always fires.
 * `hasBalance()` lets the tap handler know whether there's anything to show (so a
 * signed-out tap can fall through to normal home navigation instead).
 */
const WordmarkLogo = forwardRef(function WordmarkLogo(_props, ref) {
  const { totalSats } = useSelfBalanceSats()
  const rolled = useRollingSats(totalSats)
  const [showBalance, setShowBalance] = useState(false)
  const prevRef = useRef(null)
  const timerRef = useRef(null)
  const lastFireRef = useRef(0)
  // Latest total in a ref so the imperative handle (read at hover/tap time, after
  // commit) sees the current value without the handle being rebuilt each change.
  const totalSatsRef = useRef(null)
  useEffect(() => {
    totalSatsRef.current = totalSats
  }, [totalSats])

  // Show the balance for HOLD_MS, then revert. Returns false (a no-op) when there's
  // no balance to show, so a caller can fall back (e.g. navigate instead).
  const flash = useCallback(() => {
    if (totalSatsRef.current == null) return false
    setShowBalance(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setShowBalance(false), HOLD_MS)
    return true
  }, [])

  useImperativeHandle(
    ref,
    () => ({ flash, hasBalance: () => totalSatsRef.current != null }),
    [flash],
  )

  // Automatic flash on a real balance change (unsolicited motion → reduced-motion
  // and the reconciliation debounce both apply here, unlike a hover/tap).
  useEffect(() => {
    if (totalSats == null) return
    const prev = prevRef.current
    prevRef.current = totalSats
    if (prev == null || prev === totalSats) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return
    const now = Date.now()
    if (now - lastFireRef.current < RETRIGGER_DEBOUNCE_MS) return
    lastFireRef.current = now
    // Reacting to an external system (the live balance) crossing to a new value —
    // the legit "sync from a subscription" case (flash() sets state internally).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    flash()
  }, [totalSats, flash])

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  return (
    <span className={`wm-stack${showBalance ? ' wm-bal-on' : ''} ${bebas.variable}`}>
      <span className="wm-logo">
        <AnimatedLogo />
      </span>
      <span className="wm-bal" aria-hidden={!showBalance}>
        {rolled == null ? '' : `${formatXec(rolled)} XEC`}
      </span>
    </span>
  )
})

export default WordmarkLogo
