'use client'

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Bebas_Neue } from 'next/font/google'
import AnimatedLogo, { IGNITION_TOTAL_MS } from '@/components/AnimatedLogo'
import { useSelfBalanceSats } from '@/lib/useSelfBalanceSats'
import { useRollingSats, BALANCE_FLASH_HOLD_MS } from '@/lib/pocket/useRollingSats'

// Same face as the sign, so the number that swaps in reads as part of the mark
// (next/font dedupes an identical config, so this shares the sign's font files).
const bebas = Bebas_Neue({ weight: '400', subsets: ['latin'], display: 'swap', variable: '--pow-logo-font' })

// How long the balance stays up after a trigger before the sign returns — shared
// with the Pocket chip's flash so the two revert together.
const HOLD_MS = BALANCE_FLASH_HOLD_MS

// How long the total must hold STEADY after first appearing before the AUTOMATIC
// flash arms. The initial balance resolves in stages — the main wallet and the
// Pocket land a beat apart, and an in-app navigation re-resolves from scratch —
// and none of that settling should flash; only a change AFTER the balance is
// settled (your action, or someone else's that moves your balance) should. Each
// pre-arm change pushes this out, so even a slow multi-stage load stays quiet.
const BALANCE_ARM_MS = 1500

/** sats → whole-XEC with thousands separators (matches the Pocket chip: never
 *  abbreviated, so even a 100-XEC move is a visible digit change to roll). */
function formatXec(sats) {
  return Math.floor(sats / 100).toLocaleString()
}

/**
 * The masthead wordmark, doubling as a live balance readout. It cross-fades the
 * neon sign to the viewer's total spendable XEC (main wallet + Pocket) and back,
 * on three triggers:
 *   - the balance CHANGES after the initial load has SETTLED (auto) — a real move
 *     from your action or someone else's that touches your balance; respects
 *     reduced-motion, holds off during the sign's entrance, and skips a Pocket fee
 *     reconcile settling late (see reconcileSettlePulse) so one action is one
 *     flash. The first-load resolution itself — and an in-app nav's re-resolve —
 *     never flashes (see the arm gate in the auto-flash effect);
 *   - the banner is HOVERED (desktop) or TAPPED (mobile) — driven from FeedTopbar
 *     via the imperative `flash()` handle, a deliberate reveal that always fires.
 * `hasBalance()` lets the tap handler know whether there's anything to show (so a
 * signed-out tap can fall through to normal home navigation instead).
 */
const WordmarkLogo = forwardRef(function WordmarkLogo(_props, ref) {
  const { totalSats, reconcileSettlePulse } = useSelfBalanceSats()
  const rolled = useRollingSats(totalSats)
  const [showBalance, setShowBalance] = useState(false)
  const prevRef = useRef(null)
  const timerRef = useRef(null)
  const settlePulseRef = useRef(reconcileSettlePulse)
  // Auto-flash is OFF until the balance has held steady for BALANCE_ARM_MS after
  // first appearing — so the staged initial load (and every in-app nav re-resolve)
  // stays quiet, and only a later real change flashes.
  const armedRef = useRef(false)
  const armTimerRef = useRef(null)
  const armSoon = useCallback(() => {
    if (armTimerRef.current) clearTimeout(armTimerRef.current)
    armTimerRef.current = setTimeout(() => {
      armedRef.current = true
    }, BALANCE_ARM_MS)
  }, [])
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

  // Automatic flash — only for a balance change AFTER this mount's balance has
  // settled, never for the load itself. Reduced-motion applies (unlike a
  // hover/tap), the sign's entrance still holds it off on a hard load, and a
  // Pocket-spend fee reconcile is skipped so one action is one flash.
  useEffect(() => {
    if (totalSats == null) {
      // Unknown / re-resolving — the first load, or a sign-in / address change
      // clearing it. Treat whatever resolves next as a fresh, quiet baseline.
      prevRef.current = null
      armedRef.current = false
      if (armTimerRef.current) {
        clearTimeout(armTimerRef.current)
        armTimerRef.current = null
      }
      return
    }
    const prev = prevRef.current
    prevRef.current = totalSats
    // Keep the settle-pulse tracker current on every run, even the early returns.
    const settlePulsed = reconcileSettlePulse !== settlePulseRef.current
    settlePulseRef.current = reconcileSettlePulse

    if (prev == null) {
      armSoon() // first value for this mount → the baseline; start the arm window
      return
    }
    if (prev === totalSats) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return
    // Still settling the staged initial load (main wallet + Pocket land a beat
    // apart; an in-app nav re-resolves from scratch). Each change pushes the arm
    // point out, so we only arm — and only then flash — once the balance is quiet.
    if (!armedRef.current) {
      armSoon()
      return
    }
    // Hard load: let the sign finish lighting up before the balance takes over.
    // (No-op on in-app nav, where performance.now() is already well past this —
    // see hasIgnitedThisLoad — so a real change there still flashes.)
    if (performance.now() < IGNITION_TOTAL_MS) return
    // A Pocket spend's optimistic drop omits the network fee; when the overlay
    // later settles to the reconciled figure (a ws nudge in ~1-2s, or a 20s
    // fallback) that's this SAME total settling late, not a new action — skip it,
    // keyed off the store's pulse rather than an elapsed-time window.
    if (settlePulsed) return
    // Reacting to an external system (the live balance) crossing to a new value —
    // the legit "sync from a subscription" case (flash() sets state internally).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    flash()
  }, [totalSats, reconcileSettlePulse, flash, armSoon])

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      if (armTimerRef.current) clearTimeout(armTimerRef.current)
    },
    [],
  )

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
