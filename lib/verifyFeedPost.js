// =============================================================================
//  verifyFeedPost.js
//  On-chain verification for the paid feed. Mirrors the article-unlock / mint
//  verify path: same Chronik failover, same "read the payer off tx.inputs[0]",
//  same "amount is a >= floor" matching. The match key is the sha256 content
//  hash carried in our LOKAD OP_RETURN (see lib/feedProtocol.js) — the backend
//  NEVER trusts a client-sent hash; it recomputes from the stored content and
//  compares to the on-chain commitment.
//
//  Payment shape:
//    POST  — 100% to the platform address (a pay-to-post fee for your own content)
//    REPLY — 94% to the parent's payout address, 6% to the platform (same split
//            as article unlocks). Reply pays the DIRECT parent only.
// =============================================================================

import { ChronikClient } from 'chronik-client'
import { encodeCashAddress } from 'ecashaddrjs'
import { computePaymentSplit } from '@/lib/paymentSplit'
import { decodeFeedOpReturn, FEED_ACTION } from '@/lib/feedProtocol'

const CHRONIK_URLS = ['https://chronik.e.cash', 'https://chronik-native.fabien.cash']
let _chronik = null
const chronik = () => (_chronik ??= new ChronikClient(CHRONIK_URLS))

// P2PKH: 76a914<20>88ac  |  P2SH: a914<20>87  -> ecash: address
function scriptToAddress(outputScriptHex) {
  const s = String(outputScriptHex ?? '').toLowerCase()
  if (s.startsWith('76a914') && s.endsWith('88ac') && s.length === 50) {
    return encodeCashAddress('ecash', 'p2pkh', s.slice(6, 46))
  }
  if (s.startsWith('a914') && s.endsWith('87') && s.length === 46) {
    return encodeCashAddress('ecash', 'p2sh', s.slice(4, 44))
  }
  return null
}

function satsToAddress(tx, toAddress) {
  let total = 0
  for (const out of tx.outputs ?? []) {
    if (scriptToAddress(out.outputScript) === toAddress) {
      total += Number(out.sats ?? out.value ?? 0)
    }
  }
  return total
}

function payerOf(tx) {
  const first = (tx.inputs ?? [])[0]
  return first ? scriptToAddress(first.outputScript) : null
}

function feedCommitmentOf(tx) {
  for (const out of tx.outputs ?? []) {
    const script = String(out.outputScript ?? '').toLowerCase()
    if (script.startsWith('6a')) {
      const decoded = decodeFeedOpReturn(script)
      if (decoded) return decoded
    }
  }
  return null
}

/**
 * Check that `tx` satisfies the expected feed commitment and payment.
 * @returns {{ txid: string, payerAddress: string, sats: number } | null}
 */
export function matchFeedTx(tx, expected) {
  const { action, parentTxid, contentHash, platformAddress, payoutAddress, costXec } = expected

  const commit = feedCommitmentOf(tx)
  if (!commit) return null
  if (commit.action !== action) return null
  if (commit.contentHash !== String(contentHash).toLowerCase()) return null
  if (action === FEED_ACTION.REPLY) {
    if (!parentTxid || commit.parentTxid !== String(parentTxid).toLowerCase()) return null
  }

  let sats
  if (action === FEED_ACTION.POST) {
    const needSats = Math.floor(Number(costXec) * 100)
    const platformSats = satsToAddress(tx, platformAddress)
    if (platformSats < needSats) return null
    sats = platformSats
  } else {
    const split = computePaymentSplit(costXec)
    if (!split) return null
    const authorNeed = Math.floor(Number(split.authorAmount) * 100)
    const platformNeed = Math.floor(Number(split.platformAmount) * 100)
    const authorSats = satsToAddress(tx, payoutAddress)
    const platformSats = satsToAddress(tx, platformAddress)
    if (authorSats < authorNeed || platformSats < platformNeed) return null
    sats = authorSats + platformSats
  }

  const payerAddress = payerOf(tx)
  if (!payerAddress) return null

  return { txid: tx.txid, payerAddress, sats }
}

/**
 * Verify a specific txid (manual "already paid — here's the txid" path).
 * @returns {Promise<{ txid, payerAddress, sats } | null>}
 */
export async function verifyFeedTxid(txid, expected) {
  try {
    const tx = await chronik().tx(txid)
    return matchFeedTx(tx, expected)
  } catch {
    return null
  }
}

/**
 * Auto-detect: scan recent txs to the platform address (every feed action pays
 * the platform — 6% on replies, 100% on posts) for the one carrying our content
 * hash. `excludeTxids` skips already-recorded rows so identical content from a
 * different wallet isn't re-attributed.
 * @returns {Promise<{ txid, payerAddress, sats } | null>}
 */
export async function findFeedPayment(expected, { sinceUnix = 0, excludeTxids = new Set() } = {}) {
  try {
    const page = await chronik().address(expected.platformAddress).history(0, 25)
    for (const tx of page.txs ?? []) {
      if (excludeTxids.has(tx.txid)) continue
      const seen = Number(tx.timeFirstSeen ?? 0)
      if (sinceUnix && seen && seen < sinceUnix - 120) continue // small clock-skew allowance
      const match = matchFeedTx(tx, expected)
      if (match) return match
    }
    return null
  } catch {
    return null
  }
}
