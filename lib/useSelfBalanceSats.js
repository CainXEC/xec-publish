'use client'

import { useEffect, useState } from 'react'
import { usePocket } from '@/lib/pocket/store'
import { getXecBalanceSats } from '@/lib/xecBalance'
import { watchPaymentAddress } from '@/lib/ecash/watchPaymentAddress'

/**
 * The signed-in viewer's spendable XEC across their MAIN (primary login) wallet
 * PLUS their Pocket, in sats — kept live.
 *
 *  - MAIN: the account's live primary address (resolved from /api/me, re-resolved
 *    on `sessionChanged`), read from Chronik and watched over the shared payment
 *    websocket so any tx touching it re-reads the balance.
 *  - POCKET: taken from the Pocket store (already live, and already drops
 *    optimistically the instant a Pocket-paid action is sent), added only when a
 *    Pocket exists. When the Pocket feature is off/absent, this is just the main
 *    balance — the two never overlap (the Pocket is its own derived address, not
 *    the primary), so summing can't double-count.
 *
 * `totalSats` is null until we actually know a balance (so callers can hold their
 * pre-balance UI and never flash a wrong 0), and null for signed-out viewers.
 *
 * `reconcileSettlePulse` bubbles up the Pocket store's own pulse (see there):
 * it bumps whenever a totalSats change is just the Pocket's optimistic-spend
 * overlay settling to the real balance (a tx fee correcting, not new money),
 * so a caller watching totalSats generically (the wordmark takeover) can
 * suppress a reaction to that specific change instead of guessing off elapsed
 * time — the settle can land anywhere from ~1-2s to ~20s after the spend.
 */
export function useSelfBalanceSats() {
  const pocket = usePocket()
  const [mainAddress, setMainAddress] = useState(null)
  const [mainSats, setMainSats] = useState(null)

  // Resolve the account's live primary address; refresh on session change.
  useEffect(() => {
    let cancelled = false
    const resolve = async () => {
      try {
        const res = await fetch('/api/me', { cache: 'no-store' })
        const me = await res.json()
        if (cancelled) return
        setMainAddress(me?.authenticated ? me.address ?? null : null)
      } catch {
        /* network hiccup — keep whatever we had */
      }
    }
    void resolve()
    window.addEventListener('sessionChanged', resolve)
    return () => {
      cancelled = true
      window.removeEventListener('sessionChanged', resolve)
    }
  }, [])

  // Read + watch the main-wallet balance. A tx touching the address (or a
  // tab-wake/ws-reconnect) re-reads it.
  useEffect(() => {
    // Clear the previous address's balance up front (sign-out, or an account
    // switch) so the total never briefly sums a stale figure — which would also
    // spuriously fire the wordmark takeover on a switch (stale -> real looks like
    // a change). The fresh read below (null -> value) reads as a first value, not
    // a change, so it stays quiet.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMainSats(null)
    if (!mainAddress) return undefined
    let active = true
    const refresh = async () => {
      const sats = await getXecBalanceSats(mainAddress)
      if (active) setMainSats(sats)
    }
    void refresh()
    const unwatch = watchPaymentAddress(mainAddress, refresh, refresh)
    return () => {
      active = false
      unwatch?.()
    }
  }, [mainAddress])

  const pocketReady = pocket.status === 'ready'
  const pocketSats = pocketReady ? pocket.balanceSats ?? 0 : 0

  // Ready once the main balance is known (or there's no main wallet but a Pocket
  // is). Until then, null — don't show a half-summed figure that would jump.
  let totalSats = null
  if (mainAddress) {
    totalSats = mainSats == null ? null : mainSats + pocketSats
  } else if (pocketReady) {
    totalSats = pocketSats
  }

  return { totalSats, reconcileSettlePulse: pocket.reconcileSettlePulse }
}
