/**
 * The Pocket — pay gateway.
 *
 * The drop-in wrapper around lib/ecash/cashtabPay.ts that every low-value pay
 * flow calls instead of the raw trio. Tier by value (the product rule):
 * pocket-eligible actions sign locally and broadcast instantly; everything
 * else — and every failure/ineligibility — takes the EXACT Cashtab path the
 * app has today. With NEXT_PUBLIC_POCKET_ENABLED off, every function here is
 * a literal pass-through: same calls, same arguments, same behavior.
 *
 * Contract (mirrors cashtabPay so call sites keep their shape):
 *   const handle = beginPayment({ kind, amountXec })   // SYNC, in the click
 *   ...await /prepare...
 *   const r = await completePayment(handle, { bip21, cashtabUrl })
 *   // r: { ok:true, via:'pocket', txid }              — pocket paid; POST the
 *   //                                                   txid to confirm NOW
 *   //    { ok:true, via:'extension'|'tab', ... }      — Cashtab path (as today)
 *   //    { ok:false, via:'extension', reason:'denied' } — user said no (as today)
 *   //    { ok:false, via:'pocket', reason:'pocket_error', message }
 *   //                                                 — pocket failed; pending
 *   //                                                   UI + manual Cashtab
 *   //                                                   link still apply
 *   abortPayment(handle)                               // /prepare failed
 */

import {
  payWithCashtab,
  beginCashtabPayment,
  completeCashtabPayment,
  abortCashtabPayment,
  isCashtabExtensionAvailable,
} from '@/lib/ecash/cashtabPay'
import { POCKET_ENABLED, getPocketSnapshot, getPocketSpendContext, refreshPocketBalance } from '@/lib/pocket/store'

/** Hard per-payment ceiling (XEC). Anything pricier is a deliberate-signing
 *  moment and belongs in Cashtab even if the pocket could cover it. */
export const POCKET_MAX_PER_TX_XEC = 5000

/** Headroom for the network fee + change dust so eligibility never green-lights
 *  a spend the builder would reject at the margin (~2000 sats ≫ any 1-2 input
 *  P2PKH fee at 1 sat/byte). */
const FEE_MARGIN_SATS = 2000

/** The low-value, high-frequency tier. Publishing, mints, login, and
 *  change-address are deliberately absent — those should feel like signing. */
const POCKET_KINDS = new Set([
  'feed-post',
  'feed-reply',
  'feed-quote',
  'feed-poll',
  'like',
  'tip',
  'repost',
  'unlock',
  'comment',
])

/**
 * Can the pocket pay this, right now? Pure/synchronous — safe inside a click
 * handler before any await.
 * @param {string} kind    one of POCKET_KINDS (anything else → Cashtab)
 * @param {number} amountXec  total price in XEC (client always knows it at click)
 */
export function spendEligibility(kind, amountXec) {
  if (!POCKET_ENABLED) return { eligible: false, reason: 'disabled' }
  const snap = getPocketSnapshot()
  if (snap.status !== 'ready' || !snap.registered) return { eligible: false, reason: 'no_pocket' }
  if (!POCKET_KINDS.has(kind)) return { eligible: false, reason: 'kind' }
  const amount = Number(amountXec)
  if (!Number.isFinite(amount) || amount <= 0) return { eligible: false, reason: 'amount' }
  if (amount > POCKET_MAX_PER_TX_XEC) return { eligible: false, reason: 'over_max' }
  if (snap.balanceSats == null || snap.balanceSats < amount * 100 + FEE_MARGIN_SATS) {
    return { eligible: false, reason: 'balance' }
  }
  return { eligible: true }
}

/**
 * Start a payment inside the click gesture. Pocket-eligible → opens NOTHING
 * (no placeholder tab, no extension popup); otherwise identical to
 * beginCashtabPayment().
 */
export function beginPayment({ kind, amountXec }) {
  if (spendEligibility(kind, amountXec).eligible) {
    return { mode: 'pocket' }
  }
  return { mode: 'cashtab', gesture: beginCashtabPayment() }
}

/**
 * Finish a payment started with beginPayment once the BIP21 is known.
 * Pocket mode signs + broadcasts locally; on failure it silently retries via
 * the extension when present (extension popups need no window.open gesture),
 * else reports pocket_error and leaves the call site's pending UI — with its
 * existing manual "open Cashtab" affordance — to carry the payment. It never
 * window.open()s after an await (popup blockers eat those).
 */
export async function completePayment(handle, { bip21, cashtabUrl }) {
  if (handle?.mode !== 'pocket') {
    return completeCashtabPayment(handle.gesture, { bip21, cashtabUrl })
  }

  const ctx = getPocketSpendContext()
  if (ctx) {
    const { pocketSpend } = await import('@/lib/pocket/wallet')
    const spend = await pocketSpend({ skHex: ctx.skHex, bip21 })
    if (spend.ok) {
      refreshPocketBalance()
      return { ok: true, via: 'pocket', txid: spend.txid }
    }
    if (isCashtabExtensionAvailable()) {
      // Desktop with the extension: hand the SAME bip21 to its popup — the
      // user sees a normal Cashtab approval instead of an error.
      return payWithCashtab({ bip21, cashtabUrl })
    }
    return { ok: false, via: 'pocket', reason: 'pocket_error', message: spend.error }
  }

  // The pocket vanished between click and completion (other-tab forget,
  // logout race). Extension can still take over silently; the web-tab path
  // can't (no gesture left), so report and let the pending UI carry it.
  if (isCashtabExtensionAvailable()) {
    return payWithCashtab({ bip21, cashtabUrl })
  }
  return {
    ok: false,
    via: 'pocket',
    reason: 'pocket_error',
    message: 'Pocket unavailable — pay with Cashtab instead.',
  }
}

/** Abandon a payment whose /prepare failed. Pocket mode opened nothing. */
export function abortPayment(handle) {
  if (handle?.mode === 'cashtab') abortCashtabPayment(handle.gesture)
}

/**
 * One-shot variant for flows whose BIP21 is known AT the click (unlock):
 * pocket if eligible, else exactly payWithCashtab.
 */
export async function payDirect({ kind, amountXec, bip21, cashtabUrl }) {
  if (spendEligibility(kind, amountXec).eligible) {
    return completePayment({ mode: 'pocket' }, { bip21, cashtabUrl })
  }
  return payWithCashtab({ bip21, cashtabUrl })
}
