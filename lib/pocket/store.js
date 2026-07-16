/**
 * The Pocket — client state store.
 *
 * A module-level store + useSyncExternalStore hook (usePocket), following the
 * repo's "self-contained client widgets fetch their own state" pattern — no
 * provider, app/layout.tsx untouched. Resolves the signed-in account via
 * /api/me, loads the device's pocket record (lib/pocket/storage.js), keeps a
 * live balance via the shared Chronik websocket (funding and spends both nudge
 * it), and reacts to login changes (`sessionChanged`) and other-tab writes
 * (`storage`).
 *
 * The SECRET KEY is deliberately NOT kept in this state: spenders read it
 * from storage at the moment of signing (getPocketSpendContext) so React
 * state/devtools never hold key material.
 */

'use client'

import { useSyncExternalStore } from 'react'
import { loadPocket, onPocketStorageChange } from '@/lib/pocket/storage'
import { getXecBalanceSats } from '@/lib/xecBalance'
import { watchPaymentAddress } from '@/lib/ecash/watchPaymentAddress'

/** Build-time flag: pocket OFF means every pay path is byte-identical to
 *  today's Cashtab-only behavior and none of this module ever activates. */
export const POCKET_ENABLED = process.env.NEXT_PUBLIC_POCKET_ENABLED === 'true'

/** Soft cap (XEC): the UI refuses to SUGGEST topping the pocket past this.
 *  Pocket change, not a lockbox — also the ceiling on XSS/exfil damage. */
export const POCKET_SOFT_CAP_XEC = 25000

const DEFAULT_STATE = Object.freeze({
  /** 'disabled' | 'idle' | 'signedout' | 'none' | 'ready' */
  status: POCKET_ENABLED ? 'idle' : 'disabled',
  accountId: null,
  primaryAddress: null,
  sessionVia: null,
  /** the pocket address (ecash:-prefixed) when a device record exists */
  address: null,
  registered: false,
  /** spendable sats (number) — null while unknown */
  balanceSats: null,
})

let state = DEFAULT_STATE
const listeners = new Set()
let started = false
let unwatchAddress = null

function emit(patch) {
  state = Object.freeze({ ...state, ...patch })
  for (const l of listeners) l()
}

async function refreshBalanceInner(address) {
  if (!address) return
  const sats = await getXecBalanceSats(address)
  // The pocket may have changed while we awaited — only apply if still current.
  if (state.address === address) emit({ balanceSats: sats })
}

/** Public: re-read the pocket balance now (gateway calls this after a spend). */
export function refreshPocketBalance() {
  if (state.address) void refreshBalanceInner(state.address)
}

function watchPocketAddress(address) {
  if (unwatchAddress) {
    unwatchAddress()
    unwatchAddress = null
  }
  if (!address) return
  // Any tx touching the pocket (top-up landing, spend confirming) nudges an
  // immediate balance re-read; wake re-checks after tab suspend/ws reconnect.
  unwatchAddress = watchPaymentAddress(
    address,
    () => refreshBalanceInner(address),
    () => refreshBalanceInner(address),
  )
}

async function resolveAccount() {
  let me = null
  try {
    const res = await fetch('/api/me', { cache: 'no-store' })
    me = await res.json()
  } catch {
    /* network hiccup: leave current state */
    return
  }

  if (!me?.authenticated) {
    watchPocketAddress(null)
    emit({ ...DEFAULT_STATE, status: 'signedout' })
    return
  }

  const record = loadPocket(me.accountId)
  const address = record?.address ?? null
  emit({
    status: record ? 'ready' : 'none',
    accountId: me.accountId,
    primaryAddress: me.address ?? null,
    sessionVia: me.sessionVia ?? null,
    address,
    registered: record?.registered === true,
    balanceSats: state.address === address ? state.balanceSats : null,
  })
  watchPocketAddress(address)
  if (address) void refreshBalanceInner(address)
  if (record?.registered === true) schedulePocketWarm()
}

// Pre-warm the signer (ecash-wallet chunk + Wallet instance + UTXO sync) in
// idle time, so the FIRST spend of the session doesn't pay the cold-start —
// a click should only cost build + broadcast. Once per page load.
let warmScheduled = false
function schedulePocketWarm() {
  if (warmScheduled || typeof window === 'undefined') return
  warmScheduled = true
  const go = () => {
    const ctx = getPocketSpendContext()
    if (!ctx) return
    void import('@/lib/pocket/wallet')
      .then((m) => m.warmPocketWallet(ctx.skHex))
      .catch(() => {})
  }
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(go, { timeout: 4000 })
  } else {
    setTimeout(go, 800)
  }
}

/** Public: re-resolve everything (the panel calls this after creating or
 *  forgetting a pocket in THIS tab — the storage event only fires in others). */
export function refreshPocket() {
  if (POCKET_ENABLED && typeof window !== 'undefined') void resolveAccount()
}

function start() {
  if (started || !POCKET_ENABLED || typeof window === 'undefined') return
  started = true
  void resolveAccount()
  // Module-lifetime listeners (never torn down — the store outlives components).
  window.addEventListener('sessionChanged', resolveAccount)
  onPocketStorageChange(resolveAccount)
}

function subscribe(cb) {
  listeners.add(cb)
  start()
  return () => listeners.delete(cb)
}

function getSnapshot() {
  return state
}

function getServerSnapshot() {
  return DEFAULT_STATE
}

/** React hook: the pocket's live client state. Safe everywhere (SSR returns
 *  the disabled/idle default). */
export function usePocket() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

/** Non-hook snapshot for imperative callers (the pay gateway's click-time
 *  eligibility check). */
export function getPocketSnapshot() {
  return state
}

/**
 * The signing context for a spend: the CURRENT account's stored record, read
 * fresh from localStorage at the moment of use. Returns null when there is no
 * usable pocket (not signed in, no record, not registered).
 */
export function getPocketSpendContext() {
  if (!POCKET_ENABLED || !state.accountId) return null
  const record = loadPocket(state.accountId)
  if (!record || record.registered !== true) return null
  return { skHex: record.skHex, address: record.address }
}
