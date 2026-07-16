/**
 * The Pocket — pay gateway.
 *
 * The drop-in wrapper around lib/ecash/cashtabPay.ts that every pay flow
 * calls instead of the raw trio. THE RULE: the pocket pays anything it can
 * afford, signing locally and broadcasting instantly; anything it can't cover
 * — and every failure/ineligibility — takes the EXACT Cashtab path the app
 * has today, automatically. Only proof-of-keys flows (login, change-address)
 * and NFT deliveries (mint, claim) never touch the pocket. With
 * NEXT_PUBLIC_POCKET_ENABLED off, every function here is a literal
 * pass-through: same calls, same arguments, same behavior.
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
import { parseEcashBip21 } from '@/lib/pocket/bip21'

/** Headroom for the network fee + change dust so eligibility never green-lights
 *  a spend the builder would reject at the margin (~2000 sats ≫ any 1-2 input
 *  P2PKH fee at 1 sat/byte). */
const FEE_MARGIN_SATS = 2000

/** THE RULE: the pocket pays anything it can afford; Cashtab handles the rest
 *  automatically. The only exclusions are STRUCTURAL, not price policy:
 *  login/change-address (the payment is proof of the WALLET's keys — a pocket
 *  payment proves nothing and is server-rejected) and mint/claim (the NFT is
 *  delivered to the paying address — it must land in the wallet, never on a
 *  browser hot key). Those flows never route through this gateway, and any
 *  unknown kind falls through to Cashtab as a backstop. */
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
  'publish',
])

/**
 * Can the pocket pay this, right now? Pure/synchronous — safe inside a click
 * handler before any await. No price ceiling: the pocket's funding cap is the
 * bound, and a payment it can't cover routes to Cashtab automatically.
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
 * One-shot variant for flows whose BIP21 is known AT the click (unlock,
 * publish). `amountXec` may be omitted — the price is then read off the
 * BIP21 itself, so callers don't need to duplicate fee knowledge.
 */
export async function payDirect({ kind, amountXec, bip21, cashtabUrl }) {
  let amount = amountXec
  if (amount == null) {
    const parsed = parseEcashBip21(bip21)
    amount = parsed ? Number(parsed.totalSats) / 100 : NaN
  }
  if (spendEligibility(kind, amount).eligible) {
    return completePayment({ mode: 'pocket' }, { bip21, cashtabUrl })
  }
  return payWithCashtab({ bip21, cashtabUrl })
}
