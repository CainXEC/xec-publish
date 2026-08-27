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

// Module-cached Wallet per key, so repeated spends reuse the instance.
let _wallet = null
let _walletSkHex = null
let _lastSyncAt = 0
async function getWallet(skHex) {
  if (_wallet && _walletSkHex === skHex) return _wallet
  const Wallet = await loadWalletClass()
  _wallet = Wallet.fromSk(fromHex(skHex), chronik())
  _walletSkHex = skHex
  _lastSyncAt = 0
  return _wallet
}

/** Sync the UTXO set only when it's stale. ecash-wallet self-maintains its
 *  set across its own broadcasts (spent inputs removed, change added), and
 *  broadcast() re-syncs + retries on a conflict — so a recent sync is safe to
 *  reuse and saves a Chronik round trip on every spend. */
async function ensureSynced(wallet, maxAgeMs = 8000) {
  if (Date.now() - _lastSyncAt > maxAgeMs) {
    await wallet.sync()
    _lastSyncAt = Date.now()
  }
}

/**
 * Pre-warm the spend path so the click only pays for build + broadcast:
 * loads this chunk's heavy dependency (ecash-wallet), constructs the signer,
 * and freshens the UTXO set. Called in idle time when a registered pocket
 * exists, and again AT the click (overlapping the /prepare round trip).
 * Best-effort — a failed warm just means the spend does the work itself.
 */
export async function warmPocketWallet(skHex) {
  try {
    const wallet = await getWallet(skHex)
    await ensureSynced(wallet)
  } catch {
    /* warming is opportunistic */
  }
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

// A parsed BIP21 → ecash-wallet outputs: the raw OP_RETURN (re-prefixed with the
// 0x6a byte Cashtab strips) plus each payment output.
function bip21Outputs(parsed) {
  const outputs = []
  if (parsed.opReturnRaw) {
    outputs.push({ sats: 0n, script: new Script(fromHex(`6a${parsed.opReturnRaw}`)) })
  }
  for (const out of parsed.outputs) {
    outputs.push({ sats: out.sats, address: out.address })
  }
  return outputs
}

// build() optimistically mutates the in-memory UTXO set (spends inputs, adds
// change). If the broadcast then fails, that set is a lie — re-sync to restore
// truth so the next spend is honest. Best-effort.
async function resyncQuiet(skHex) {
  try {
    const wallet = await getWallet(skHex)
    await wallet.sync()
    _lastSyncAt = Date.now()
  } catch {
    /* the next ensureSynced will try again */
  }
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
      // Usually a no-op: the warm path (idle + at-click) keeps the set fresh,
      // and broadcast() self-heals a stale set by syncing + retrying.
      await ensureSynced(wallet)

      const resp = await wallet.action({ outputs: bip21Outputs(parsed) }).build().broadcast()
      if (resp && resp.success === false) {
        return { ok: false, error: 'Broadcast was rejected — try again.' }
      }
      const broadcasted = Array.isArray(resp?.broadcasted) ? resp.broadcasted : []
      const txid = broadcasted[broadcasted.length - 1]
      if (!txid) return { ok: false, error: 'Broadcast returned no transaction id.' }
      // The instance's UTXO set was self-updated by the broadcast — as fresh
      // as a sync would make it.
      _lastSyncAt = Date.now()
      return { ok: true, txid }
    } catch (e) {
      return { ok: false, error: friendlyError(e) }
    }
  })
}

/**
 * Like pocketSpend, but hands back the txid the instant the tx is SIGNED — before
 * the broadcast network round-trip — so a caller can show the result instantly.
 *
 * The txid is the double-sha256 of the signed tx, so it's fully known at build();
 * the broadcast only *publishes* that exact tx (this ecash-wallet build never
 * rebuilds under broadcast, so the built txid is final). We build with a fresh
 * UTXO set (ensureSynced first) precisely so the signed tx — and its id — can't
 * change, then broadcast in the background.
 *
 * @param {{ skHex: string, bip21: string }} args
 * @returns {{ built: Promise<{ ok: true, txid: string } | { ok: false, error: string }>,
 *            done: Promise<{ ok: true } | { ok: false, error: string }> }}
 *   `built` settles when the tx is signed (the id is real); `done` settles when
 *   the broadcast lands (or fails — the set is re-synced to undo build()'s
 *   optimistic mutation). Broadcast runs INSIDE the spend mutex, so a rapid next
 *   spend still chains correctly; the caller only awaits `built` to feel instant.
 */
export function pocketSpendDeferred({ skHex, bip21 }) {
  const parsed = parseEcashBip21(bip21)
  let settleBuilt
  const built = new Promise((resolve) => {
    settleBuilt = resolve
  })
  const done = serialize(async () => {
    if (!parsed) {
      const r = { ok: false, error: 'This payment needs Cashtab.' }
      settleBuilt(r)
      return r
    }
    let action
    try {
      const wallet = await getWallet(skHex)
      // Build against a correct set so the signed tx (and its txid) is FINAL — a
      // stale set would force a rebuild that changes the id we already showed.
      await ensureSynced(wallet)
      action = wallet.action({ outputs: bip21Outputs(parsed) }).build()
      const txs = Array.isArray(action?.txs) ? action.txs : []
      const txid = txs.length > 0 ? txs[txs.length - 1].txid() : null
      if (!txid) {
        const r = { ok: false, error: 'Could not sign the payment — try again.' }
        settleBuilt(r)
        return r
      }
      // build() self-updated the in-memory set.
      _lastSyncAt = Date.now()
      settleBuilt({ ok: true, txid })
    } catch (e) {
      const r = { ok: false, error: friendlyError(e) }
      settleBuilt(r)
      return r
    }
    // Background broadcast — the caller has already shown the post. On failure,
    // re-sync so build()'s optimistic set mutation doesn't poison the next spend.
    try {
      const resp = await action.broadcast()
      if (resp && resp.success === false) {
        await resyncQuiet(skHex)
        return { ok: false, error: 'Broadcast was rejected — try again.' }
      }
      return { ok: true }
    } catch (e) {
      await resyncQuiet(skHex)
      return { ok: false, error: friendlyError(e) }
    }
  })
  return { built, done }
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
      // A sweep must see EVERYTHING — always a full, fresh sync (it's a rare,
      // deliberate action; the spend path's freshness shortcut has no place here).
      await wallet.sync()
      _lastSyncAt = Date.now()
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
