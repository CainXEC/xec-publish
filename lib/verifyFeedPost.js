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

// The platform's fixed cut (see computePaymentSplit: author floor(94%), platform
// the rest). Used to rebuild a self-payment's total from its clean platform leg.
const PLATFORM_FEE_FRACTION = 0.06

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
  // 94/6 to the referenced post's author and the platform. A SELF-reply (you
  // reply to your own post) is forced 100% platform too — `expected.platformOnly`
  // — so you can't rebate 94% back to yourself (net-6 self-thread padding).
  const platformOnly =
    action === FEED_ACTION.POST ||
    action === FEED_ACTION.QUOTE ||
    expected.platformOnly === true

  const payerAddress = payerOf(tx)
  if (!payerAddress) return null

  // `costXec` is only the FLOOR for a reaction — a like can carry a tip far above
  // it — so `sats` records what was ACTUALLY paid on chain, not the floor. (This
  // once recorded the floor, so a 10,000 XEC tip showed as 100 XEC on the rail
  // and was mis-classified as a plain like.)
  //
  // The one wrinkle is a SELF-payment (liking/replying to your OWN post): the
  // tx's change returns to the payout address, so summing the outputs there folds
  // the change into the amount (a 100 XEC reply could read as 4,256 XEC). The
  // platform output is always clean — the platform is never the payer — so when
  // the payer IS the payee we lean on the platform leg alone and reconstruct the
  // whole from the fixed split; otherwise both legs are clean and we sum them.
  let sats
  if (platformOnly) {
    const needSats = Math.floor(Number(costXec) * 100)
    const platformSats = satsToAddress(tx, platformAddress)
    if (platformSats < needSats) return null
    // Platform is never the payer, so this output is the real amount, floor or above.
    sats = platformSats
  } else {
    const split = computePaymentSplit(costXec)
    if (!split) return null
    const authorNeed = Math.floor(Number(split.authorAmount) * 100)
    const platformNeed = Math.floor(Number(split.platformAmount) * 100)
    const authorSats = satsToAddress(tx, payoutAddress)
    const platformSats = satsToAddress(tx, platformAddress)
    if (authorSats < authorNeed || platformSats < platformNeed) return null
    if (payerAddress === payoutAddress) {
      // Self-payment: authorSats is polluted by change. Rebuild the total from
      // the clean platform leg using the fixed 94/6 split (platform = 6%). Exact
      // for every round-number tip (the 100/1K/10K/100K/1M presets); a fractional
      // custom self-tip lands within a XEC, which is immaterial for a self-tip.
      sats = Math.round(platformSats / PLATFORM_FEE_FRACTION)
    } else {
      sats = authorSats + platformSats
    }
  }

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

  const payerAddress = payerOf(tx)
  if (!payerAddress) return null

  // A SELF-reply (you reply to your OWN comment) is forced 100% platform —
  // `expected.platformOnly` — so no 94% rebates back to you. The platform leg is
  // clean (the platform is never the payer), so it's the whole amount.
  if (expected.platformOnly === true) {
    const needSats = Math.floor(Number(costXec) * 100)
    const platformSats = satsToAddress(tx, platformAddress)
    if (platformSats < needSats) return null
    return { txid: tx.txid, payerAddress, sats: platformSats, isFinal: txIsFinal(tx) }
  }

  const split = computePaymentSplit(costXec)
  if (!split) return null
  const authorNeed = Math.floor(Number(split.authorAmount) * 100)
  const platformNeed = Math.floor(Number(split.platformAmount) * 100)
  const authorSats = satsToAddress(tx, payoutAddress)
  const platformSats = satsToAddress(tx, platformAddress)
  if (authorSats < authorNeed || platformSats < platformNeed) return null

  // Record the amount PAID for the action (the split total), not the sum of
  // outputs to the payee — when someone replies to their OWN comment the change
  // returns to that same address and would otherwise inflate the recorded amount.
  return { txid: tx.txid, payerAddress, sats: authorNeed + platformNeed, isFinal: txIsFinal(tx) }
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
 * Shared scanner behind findCommentPayment / findFeedPayment. Every paid action
 * (comment or feed) sends the platform its cut, so both detect the payment the
 * same way: page the platform address's recent history and return the first tx
 * the given `match` fn accepts. They differ ONLY in that matcher (payee split),
 * so the scan loop lives here once. `excludeTxids` skips already-recorded rows.
 */
async function findPlatformPayment(expected, { sinceUnix = 0, excludeTxids = new Set() } = {}, match) {
  try {
    const page = await chronik().address(expected.platformAddress).history(0, 25)
    for (const tx of page.txs ?? []) {
      if (excludeTxids.has(tx.txid)) continue
      const seen = Number(tx.timeFirstSeen ?? 0)
      if (sinceUnix && seen && seen < sinceUnix - 120) continue // small clock-skew allowance
      const m = match(tx, expected)
      if (m) return m
    }
    return null
  } catch {
    return null
  }
}

/**
 * Auto-detect a comment payment (content hash + 94/6 payee split).
 */
export async function findCommentPayment(expected, opts = {}) {
  return findPlatformPayment(expected, opts, matchCommentTx)
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
export async function findFeedPayment(expected, opts = {}) {
  return findPlatformPayment(expected, opts, matchFeedTx)
}

// ---------------------------------------------------------------------------
//  Profile tips — a direct tip to an AUTHOR (not a post). 100% to the author,
//  NO platform fee, so the tx has a single non-change output to the author's
//  payout address and carries the bare TIP marker (see FEED_ACTION.TIP). Because
//  there's no platform leg, tips are detected by scanning the AUTHOR's payout
//  address history (not the platform address, as feed actions are).
// ---------------------------------------------------------------------------

/**
 * Check that `tx` is a tip to `expected.payoutAddress` for at least
 * `expected.costXec` XEC. The tip carries the TIP marker and pays the author
 * directly. A self-tip (payer == payee) is rejected: it's pointless, and the
 * change output would pollute the amount anyway.
 * @param {object} tx
 * @param {{ payoutAddress: string, costXec: number|string }} expected
 * @returns {{ txid, payerAddress, sats, isFinal } | null}
 */
export function matchTipTx(tx, expected) {
  const { payoutAddress, costXec } = expected

  const commit = feedCommitmentOf(tx)
  if (!commit || commit.action !== FEED_ACTION.TIP) return null

  const payerAddress = payerOf(tx)
  if (!payerAddress) return null
  // A tip pays someone ELSE. If the payer is the payee, the "author output" is
  // just change — reject rather than record a meaningless self-tip.
  if (payerAddress === payoutAddress) return null

  const needSats = Math.floor(Number(costXec) * 100)
  const authorSats = satsToAddress(tx, payoutAddress)
  if (authorSats < needSats) return null

  return { txid: tx.txid, payerAddress, sats: authorSats, isFinal: txIsFinal(tx) }
}

/** Verify a specific tip txid (client-known txid / manual paste path). */
export async function verifyTipTxid(txid, expected) {
  try {
    return matchTipTx(await chronik().tx(txid), expected)
  } catch {
    return null
  }
}

/**
 * Auto-detect a tip by scanning recent txs TO the author's payout address for
 * one carrying the TIP marker (the web-tab fallback, when no txid is known).
 * `excludeTxids` skips already-recorded tips so a repeat scan doesn't re-attribute.
 * @returns {Promise<{ txid, payerAddress, sats, isFinal } | null>}
 */
export async function findTipPayment(expected, { sinceUnix = 0, excludeTxids = new Set() } = {}) {
  try {
    const page = await chronik().address(expected.payoutAddress).history(0, 25)
    for (const tx of page.txs ?? []) {
      if (excludeTxids.has(tx.txid)) continue
      const seen = Number(tx.timeFirstSeen ?? 0)
      if (sinceUnix && seen && seen < sinceUnix - 120) continue // small clock-skew allowance
      const m = matchTipTx(tx, expected)
      if (m) return m
    }
    return null
  } catch {
    return null
  }
}
