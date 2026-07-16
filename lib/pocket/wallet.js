/**
 * The Pocket — client-side signer.
 *
 * The ONLY file that touches ecash-wallet, and only via `await import()`: a
 * visitor who never enables the pocket never downloads the signer. Spends
 * re-use the exact BIP21 intents the Cashtab flows get (lib/pocket/bip21.js),
 * so on-chain output shapes — 94/6 splits, POWR OP_RETURN — are identical to
 * a Cashtab payment, and the existing confirm/verify endpoints accept them
 * with zero changes.
 *
 * Concurrency: one in-tab mutex serializes rapid taps (two likes in a second
 * would otherwise double-spend the same UTXO); across tabs, ecash-wallet's
 * broadcast({retryOnUtxoConflict:true}) syncs-and-rebuilds on
 * missing-or-spent, so the loser of a cross-tab race self-heals.
 */

import { Script, fromHex } from 'ecash-lib'
import { ChronikClient } from 'chronik-client'
import { CHRONIK_URLS } from '@/lib/ecash/chronikEndpoints'
import { parseEcashBip21 } from '@/lib/pocket/bip21'

let _chronik = null
const chronik = () => (_chronik ??= new ChronikClient(CHRONIK_URLS))

let _WalletClass = null
async function loadWalletClass() {
  if (_WalletClass) return _WalletClass
  const mod = await import('ecash-wallet')
  _WalletClass = mod.Wallet ?? mod.default?.Wallet
  if (!_WalletClass) throw new Error('ecash-wallet did not export Wallet')
  return _WalletClass
}

// Module-cached Wallet per key, so repeated spends reuse the instance (sync()
// still runs per spend — the UTXO set is what changes).
let _wallet = null
let _walletSkHex = null
async function getWallet(skHex) {
  if (_wallet && _walletSkHex === skHex) return _wallet
  const Wallet = await loadWalletClass()
  _wallet = Wallet.fromSk(fromHex(skHex), chronik())
  _walletSkHex = skHex
  return _wallet
}

// In-tab spend mutex: chain every spend/sweep behind the previous one.
let _spendChain = Promise.resolve()
function serialize(fn) {
  const run = _spendChain.then(fn, fn)
  // keep the chain alive whether fn resolved or rejected
  _spendChain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

function friendlyError(e) {
  const msg = String(e?.message ?? e ?? '')
  if (/insufficient/i.test(msg)) return 'Pocket balance is too low for this payment.'
  if (/fetch|network|timeout|socket/i.test(msg)) return 'Network hiccup talking to the chain — try again.'
  return 'Pocket payment failed — you can pay with Cashtab instead.'
}

/**
 * Pay a parsed-able BIP21 from the pocket: sign locally, broadcast to Chronik.
 * @param {{ skHex: string, bip21: string }} args
 * @returns {Promise<{ ok: true, txid: string } | { ok: false, error: string }>}
 */
export function pocketSpend({ skHex, bip21 }) {
  return serialize(async () => {
    const parsed = parseEcashBip21(bip21)
    if (!parsed) {
      // Unknown BIP21 params are Cashtab's business, never the pocket's.
      return { ok: false, error: 'This payment needs Cashtab.' }
    }
    try {
      const wallet = await getWallet(skHex)
      await wallet.sync()

      const outputs = []
      if (parsed.opReturnRaw) {
        // op_return_raw is the script WITHOUT the leading OP_RETURN byte
        // (Cashtab re-adds it); ecash-wallet wants the full script — re-prefix.
        outputs.push({ sats: 0n, script: new Script(fromHex(`6a${parsed.opReturnRaw}`)) })
      }
      for (const out of parsed.outputs) {
        outputs.push({ sats: out.sats, address: out.address })
      }

      const resp = await wallet.action({ outputs }).build().broadcast()
      if (resp && resp.success === false) {
        return { ok: false, error: 'Broadcast was rejected — try again.' }
      }
      const broadcasted = Array.isArray(resp?.broadcasted) ? resp.broadcasted : []
      const txid = broadcasted[broadcasted.length - 1]
      if (!txid) return { ok: false, error: 'Broadcast returned no transaction id.' }
      return { ok: true, txid }
    } catch (e) {
      return { ok: false, error: friendlyError(e) }
    }
  })
}

/**
 * Sweep the ENTIRE pocket balance back to `toAddress` (the account's main
 * wallet). Always available — the pocket is pocket change, never a lockbox.
 * @param {{ skHex: string, toAddress: string }} args
 * @returns {Promise<{ ok: true, txid: string, sats: bigint } | { ok: false, error: string }>}
 */
export function pocketSweep({ skHex, toAddress }) {
  return serialize(async () => {
    const to = String(toAddress ?? '').trim()
    if (!to) return { ok: false, error: 'No destination address.' }
    try {
      const wallet = await getWallet(skHex)
      await wallet.sync()
      const max = wallet.maxSendSats()
      if (max <= 0n) return { ok: false, error: 'Nothing to sweep.' }
      const resp = await wallet.action({ outputs: [{ sats: max, address: to }] }).build().broadcast()
      if (resp && resp.success === false) {
        return { ok: false, error: 'Broadcast was rejected — try again.' }
      }
      const broadcasted = Array.isArray(resp?.broadcasted) ? resp.broadcasted : []
      const txid = broadcasted[broadcasted.length - 1]
      if (!txid) return { ok: false, error: 'Broadcast returned no transaction id.' }
      return { ok: true, txid, sats: max }
    } catch (e) {
      return { ok: false, error: friendlyError(e) }
    }
  })
}
