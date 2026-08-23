// =============================================================================
//  lib/feed/buildFeedPayment.js — CLIENT-SIDE payment builder for POST & QUOTE.
//
//  A post or quote always pays ONE fixed, public address (the platform, 100%),
//  so the browser can assemble the exact same BIP21 + OP_RETURN that
//  /api/feed/prepare produces — using the identical pure functions — and hand it
//  straight to the Pocket to broadcast. That removes the /prepare server round
//  trip (a cold-start-prone serverless hop) from the pay path, so posting behaves
//  like a Cashtab send: the device builds it and broadcasts, no waiting on a
//  server to wake up.
//
//  This is a LATENCY optimization, not a trust change. /api/feed/confirm still
//  re-derives everything server-side (re-prices, re-hashes the stored content,
//  and verifies the on-chain tx paid the platform the right amount with the right
//  OP_RETURN via verifyFeedTxid) — a client-sent hash is never trusted, and a
//  malformed/wrong payment simply fails confirm. Byte-for-byte agreement is
//  guaranteed because both sides call the SAME priceFeedPost / contentHashHex /
//  encodeFeedOpReturnRaw / buildPublishFeeBip21, over the same content, and read
//  the same NEXT_PUBLIC_POW_LOKAD_HEX.
//
//  REPLIES are NOT here: a reply pays ANOTHER user (the parent author, or the
//  forum runner for a forum reply), whose CURRENT payout address is a live,
//  un-spoofable lookup only the server can do — so replies keep /prepare. POLLS
//  also keep /prepare (their confirm flow is server-driven).
//
//  If NEXT_PUBLIC_PLATFORM_XEC_ADDRESS isn't exposed (or content doesn't price),
//  the builder returns { ok:false } and the caller falls back to /prepare — so
//  the feature degrades to today's behavior rather than breaking.
// =============================================================================

import { priceFeedPost } from '@/lib/feedPricing'
import { contentHashHex, encodeFeedOpReturnRaw, FEED_ACTION } from '@/lib/feedProtocol'
import { buildPublishFeeBip21 } from '@/lib/paymentSplit'

// The platform payout address, exposed to the browser. Public by nature — every
// on-chain post payment already reveals it — so shipping it to the client is safe
// and is what lets a post/quote payment be assembled without a server hop.
const PLATFORM_ADDRESS = (process.env.NEXT_PUBLIC_PLATFORM_XEC_ADDRESS || '').trim()

const HEX64 = /^[0-9a-f]{64}$/

/** Can this action's payment be built locally? Post + quote only (they pay 100%
 *  platform); replies pay another user, and a poll's confirm is server-driven. */
export function canBuildFeedPaymentLocally(action, { poll = false } = {}) {
  if (!PLATFORM_ADDRESS) return false
  if (poll) return false
  return action === 'post' || action === 'quote'
}

/**
 * Assemble the payment request /api/feed/prepare returns for a POST or QUOTE,
 * in the browser. Returns the SAME shape the server does (so ComposeBox is
 * agnostic to where it came from), or { ok:false, reason } to fall back to
 * /prepare.
 *
 * @param {{ action: 'post'|'quote', content: string, quotedTxid?: string|null }} args
 */
export function buildFeedPaymentLocally({ action, content, quotedTxid = null }) {
  if (!PLATFORM_ADDRESS) return { ok: false, reason: 'no_platform_address' }

  const normAction = action === 'quote' ? FEED_ACTION.QUOTE : FEED_ACTION.POST

  // A quote must reference a real txid; if it's missing/malformed, defer to
  // /prepare (which validates the quoted post exists) rather than encode garbage.
  const targetTxid =
    normAction === FEED_ACTION.QUOTE
      ? (typeof quotedTxid === 'string' ? quotedTxid.trim().toLowerCase() : '')
      : null
  if (normAction === FEED_ACTION.QUOTE && !HEX64.test(targetTxid || '')) {
    return { ok: false, reason: 'invalid_quoted_txid' }
  }

  const priced = priceFeedPost(content, { action })
  if (!priced.ok) {
    return { ok: false, reason: 'unpriceable', error: priced.error, chars: priced.chars }
  }

  const contentHash = contentHashHex(content)
  let opReturnRaw
  try {
    opReturnRaw = encodeFeedOpReturnRaw({ action: normAction, targetTxid, contentHash })
  } catch (e) {
    return { ok: false, reason: 'encode_failed', error: e?.message }
  }

  const bip21Url = buildPublishFeeBip21(PLATFORM_ADDRESS, priced.costXec, opReturnRaw)
  if (!bip21Url) return { ok: false, reason: 'bip21_failed' }

  // Mirrors the /api/feed/prepare JSON exactly (POST/QUOTE branch).
  return {
    ok: true,
    action: normAction,
    parentTxid: null,
    quotedTxid: targetTxid,
    chars: priced.chars,
    costXec: priced.costXec,
    amountXec: priced.costXec,
    contentHash,
    bip21Url,
    payAddress: PLATFORM_ADDRESS,
    cashtabUrl: `https://cashtab.com/#/send?bip21=${bip21Url}`,
    preparedAt: Math.floor(Date.now() / 1000),
    local: true,
  }
}
