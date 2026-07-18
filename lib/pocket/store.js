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
  /** the signed-in account's live byline (@handle or address) + its chosen color,
   *  from /api/me — used to build the optimistic post a pocket-paid compose shows
   *  before the server records it. */
  identity: null,
  handleColor: null,
  /** the pocket address (ecash:-prefixed) when a device record exists */
  address: null,
  registered: false,
  /** spendable sats (number) — null while unknown. This is the DISPLAYED balance:
   *  last Chronik read minus any in-flight optimistic spends (see below). */
  balanceSats: null,
  /** bumps on every pocket spend — the chip animates the roll/flash off this. */
  spendPulse: 0,
})

let state = DEFAULT_STATE
const listeners = new Set()
let started = false
let unwatchAddress = null

function emit(patch) {
  state = Object.freeze({ ...state, ...patch })
  for (const l of listeners) l()
}

// --- optimistic balance overlay --------------------------------------------
// DISPLAYED balance = last Chronik read − in-flight optimistic spends. A pocket
// spend drops the number the instant it's SENT (no waiting for Chronik to index
// the tx); Chronik reconciles it a second later via the ws nudge. This is what
// makes a like feel like it cost something immediately.
let chronikSats = null        // last real balance from Chronik (source of truth)
let pendingSpentSats = 0       // optimistic spends not yet reflected on-chain
let spendPulse = 0             // increments per spend — drives the chip animation
let pendingClearTimer = null

function displayedSats() {
  if (chronikSats == null) return null
  return Math.max(0, chronikSats - pendingSpentSats)
}

function emitBalance() {
  emit({ balanceSats: displayedSats(), spendPulse })
}

/** Reset the overlay (pocket switch / signout) so a stale spend can't bleed
 *  onto a different pocket's balance. */
function resetOverlay() {
  chronikSats = null
  pendingSpentSats = 0
  if (pendingClearTimer) { clearTimeout(pendingClearTimer); pendingClearTimer = null }
}

async function refreshBalanceInner(address) {
  if (!address) return
  const sats = await getXecBalanceSats(address)
  // The pocket may have changed while we awaited — only apply if still current.
  if (state.address !== address) return
  const prev = chronikSats
  chronikSats = sats
  // Reconcile the overlay: any DROP since the last read is (at least) our pending
  // spends landing on-chain — retire that much so we don't double-count. A rise
  // (a top-up) leaves the overlay untouched.
  if (prev != null && pendingSpentSats > 0 && sats < prev) {
    pendingSpentSats = Math.max(0, pendingSpentSats - (prev - sats))
  }
  emitBalance()
}

/** Public: re-read the pocket balance now (gateway calls this after a spend). */
export function refreshPocketBalance() {
  if (state.address) void refreshBalanceInner(state.address)
}

/**
 * A pocket spend was just SENT (amountSats to the recipient): drop the displayed
 * balance now and pulse the chip to animate, before Chronik has even seen the
 * tx. The ws nudge (~1-2s) reconciles it via refreshBalanceInner; a safety timer
 * force-clears the overlay if no nudge ever lands, so it can never stick.
 */
export function applyOptimisticSpend(amountSats) {
  const amt = Number(amountSats)
  if (!POCKET_ENABLED || !Number.isFinite(amt) || amt <= 0) return
  pendingSpentSats += amt
  spendPulse += 1
  emitBalance()
  if (pendingClearTimer) clearTimeout(pendingClearTimer)
  pendingClearTimer = setTimeout(() => {
    pendingClearTimer = null
    pendingSpentSats = 0
    emitBalance()
    if (state.address) void refreshBalanceInner(state.address)
  }, 20000)
}

/** The spend FAILED after we'd optimistically decremented — roll it back. */
export function undoOptimisticSpend(amountSats) {
  const amt = Number(amountSats)
  if (!Number.isFinite(amt) || amt <= 0) return
  pendingSpentSats = Math.max(0, pendingSpentSats - amt)
  emitBalance()
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
    resetOverlay()
    emit({ ...DEFAULT_STATE, status: 'signedout' })
    return
  }

  const record = loadPocket(me.accountId)
  const address = record?.address ?? null
  // Switching pockets (or into a different account) invalidates the previous
  // pocket's optimistic overlay.
  if (address !== state.address) resetOverlay()
  emit({
    status: record ? 'ready' : 'none',
    accountId: me.accountId,
    primaryAddress: me.address ?? null,
    sessionVia: me.sessionVia ?? null,
    identity: me.identity ?? null,
    handleColor: me.handleColor ?? null,
    address,
    registered: record?.registered === true,
    balanceSats: displayedSats(),
    spendPulse,
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
