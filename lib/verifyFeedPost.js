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
//    POST   — 100% to the platform address (a pay-to-post fee for your own content)
//    QUOTE  — 100% to the platform (a quote is your own content, priced like a post)
//    REPLY  — 94% to the parent's payout address, 6% to the platform (same split
//             as article unlocks). Reply pays the DIRECT parent only.
//    LIKE   — flat 100 XEC, 94% to the liked post's author, 6% to the platform.
//    REPOST — flat 100 XEC, same split as a like, to the reposted post's author.
// =============================================================================

import { ChronikClient } from 'chronik-client'
import { encodeCashAddress } from 'ecashaddrjs'
import { computePaymentSplit } from '@/lib/paymentSplit'
import { decodeFeedOpReturn, FEED_ACTION } from '@/lib/feedProtocol'
import { txIsFinal } from '@/lib/ecash/finality'
import { CHRONIK_URLS } from '@/lib/ecash/chronikEndpoints'

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
 * `isFinal` reflects Avalanche finality — callers must gate global publication
 * on it so a 0-conf double-spend can't inject a "phantom" post/reaction.
 * @returns {{ txid: string, payerAddress: string, sats: number, isFinal: boolean } | null}
 */
export function matchFeedTx(tx, expected) {
  const { action, parentTxid, contentHash, platformAddress, payoutAddress, costXec } = expected

  const commit = feedCommitmentOf(tx)
  if (!commit) return null
  if (commit.action !== action) return null

  // Content-bearing actions (post/reply/quote) must commit to our exact hash;
  // repost/like carry no content, so there is no hash to match.
  const carriesHash =
    action === FEED_ACTION.POST ||
    action === FEED_ACTION.REPLY ||
    action === FEED_ACTION.QUOTE
  if (carriesHash && commit.contentHash !== String(contentHash).toLowerCase()) return null

  // Actions that reference another tx must commit to the expected target.
  const carriesTarget = action !== FEED_ACTION.POST
  if (carriesTarget) {
    if (!parentTxid || commit.targetTxid !== String(parentTxid).toLowerCase()) return null
  }

  // Payment shape: post and quote are 100% platform; reply/like/repost split
  // 94/6 to the referenced post's author and the platform.
  const platformOnly = action === FEED_ACTION.POST || action === FEED_ACTION.QUOTE

  let sats
  if (platformOnly) {
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

  return { txid: tx.txid, payerAddress, sats, isFinal: txIsFinal(tx) }
}

/**
 * Article-comment variant of matchFeedTx. Comments always pay someone 94/6 (a
 * top-level comment pays the ARTICLE author, a reply pays the PARENT comment's
 * author) — unlike a feed POST, which is 100% platform. So the split path is
 * unconditional here; only the OP_RETURN action differs:
 *   top-level comment → POST (action 1, contentHash, no target)
 *   reply to comment  → REPLY (action 2, targetTxid = parent comment txid, contentHash)
 * `expected.payoutAddress` is the payee (article author, or parent commenter).
 * On-chain the actions are COMMENT (10, no target) for a top-level comment or a
 * reply to a legacy free comment, and COMMENT_REPLY (11, targetTxid = parent
 * comment txid) for a reply to a paid comment.
 * @returns {{ txid, payerAddress, sats, isFinal } | null}
 */
export function matchCommentTx(tx, expected) {
  const { action, parentTxid, contentHash, platformAddress, payoutAddress, costXec } = expected

  const commit = feedCommitmentOf(tx)
  if (!commit) return null
  if (commit.action !== action) return null
  // Both comment actions carry the content hash — it's the "proof of writing".
  if (commit.contentHash !== String(contentHash).toLowerCase()) return null
  // A comment reply must commit to the exact parent comment it answers.
  if (action === FEED_ACTION.COMMENT_REPLY) {
    if (!parentTxid || commit.targetTxid !== String(parentTxid).toLowerCase()) return null
  }

  const split = computePaymentSplit(costXec)
  if (!split) return null
  const authorNeed = Math.floor(Number(split.authorAmount) * 100)
  const platformNeed = Math.floor(Number(split.platformAmount) * 100)
  const authorSats = satsToAddress(tx, payoutAddress)
  const platformSats = satsToAddress(tx, platformAddress)
  if (authorSats < authorNeed || platformSats < platformNeed) return null

  const payerAddress = payerOf(tx)
  if (!payerAddress) return null

  return { txid: tx.txid, payerAddress, sats: authorSats + platformSats, isFinal: txIsFinal(tx) }
}

/** Verify a specific comment txid (manual / ws-nudge path). */
export async function verifyCommentTxid(txid, expected) {
  try {
    return matchCommentTx(await chronik().tx(txid), expected)
  } catch {
    return null
  }
}

/**
 * Auto-detect a comment payment by scanning recent txs to the platform address
 * (every comment pays the platform its 6%), matched on the content hash + payee
 * split. `excludeTxids` skips already-recorded comments.
 */
export async function findCommentPayment(expected, { sinceUnix = 0, excludeTxids = new Set() } = {}) {
  try {
    const page = await chronik().address(expected.platformAddress).history(0, 25)
    for (const tx of page.txs ?? []) {
      if (excludeTxids.has(tx.txid)) continue
      const seen = Number(tx.timeFirstSeen ?? 0)
      if (sinceUnix && seen && seen < sinceUnix - 120) continue
      const match = matchCommentTx(tx, expected)
      if (match) return match
    }
    return null
  } catch {
    return null
  }
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
