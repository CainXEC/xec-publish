/**
 * POWR OP_RETURN commitment protocol ("Proof of Writing").
 *
 * One envelope covers every on-chain action the platform emits — the feed
 * (post/reply/quote/repost/like) plus the site actions that used to ride a bare,
 * LOKAD-less UUID push: article publish, paywall unlock, wallet-auth login, and
 * handle-NFT mint payment. They now all share the same POWR frame so Cashtab can
 * parse & label them AND so Chronik indexes them under the POWR LOKAD (the 4-byte
 * LOKAD must be the FIRST push after OP_RETURN for chronik.lokadId() to see it —
 * a bare 36-byte UUID push has no LOKAD and is invisible to that index).
 *
 * On-chain layout of the OP_RETURN output script:
 *
 *   OP_RETURN                 (0x6a — added by Cashtab, NOT part of op_return_raw)
 *   <push 4> LOKAD            "PROW" while testing, "POWR" at launch (see FEED_LOKAD)
 *   OP_0                      protocol version (bare opcode, == 0)
 *   OP_N                      action as a bare opcode:
 *                               OP_1 = post,    OP_2 = reply,   OP_3 = quote,
 *                               OP_4 = repost,  OP_5 = like,    OP_6 = publish,
 *                               OP_7 = unlock,  OP_8 = auth,    OP_9 = handle,
 *                               OP_10 = comment, OP_11 = comment_reply
 *                             (handle = the handle-NFT mint payment; named to match
 *                              the frozen Cashtab spec + the "Handle Mint" wallet label.
 *                              comment/comment_reply = article comments, distinct from
 *                              feed post/reply so they read as their own action on chain)
 *   [<push 32> targetTxid]    the referenced tx: reply→immediate parent,
 *                             quote/repost/like→the target post. Absent otherwise.
 *   [<push 32> contentHash]   sha256 of the stored UTF-8 content. Present for the
 *                             content-bearing actions (post/reply/quote/publish);
 *                             absent for repost/like/unlock/auth/handle.
 *   [<push 36> nonce]         ASCII bytes of a challenge/id UUID. Present for auth
 *                             (OP_8, login nonce) and handle (OP_9, pending_mints id).
 *
 * So the per-action layout is:
 *   post    : LOKAD | v0 | OP_1 |            | contentHash
 *   reply   : LOKAD | v0 | OP_2 | targetTxid | contentHash
 *   quote   : LOKAD | v0 | OP_3 | targetTxid | contentHash
 *   repost  : LOKAD | v0 | OP_4 | targetTxid
 *   like    : LOKAD | v0 | OP_5 | targetTxid
 *   publish : LOKAD | v0 | OP_6 |            | contentHash
 *   unlock  : LOKAD | v0 | OP_7      (the minimal 8-byte marker, no payload)
 *   auth    : LOKAD | v0 | OP_8 |                          | nonce (36B UUID)
 *   handle  : LOKAD | v0 | OP_9 |                          | nonce (36B mint id)
 *   comment : LOKAD | v0 | OP_10 |           | contentHash
 *   creply  : LOKAD | v0 | OP_11 | targetTxid | contentHash  (targetTxid = parent comment)
 *   delegate: LOKAD | v0 | OP_12 | pubkey (33B compressed)
 *                             (rides a Pocket FUNDING payment: the sender wallet
 *                              publicly commits "this pubkey is my spending
 *                              delegate" — on-chain provenance for the pocket
 *                              link, additive to the frozen spec)
 *   tip     : LOKAD | v0 | OP_13     (the minimal marker, no payload — like unlock)
 *                             (a direct tip to an AUTHOR from their profile: 100%
 *                              to the author, no platform fee, no post to target.
 *                              The recipient is the single non-change output's
 *                              address; the marker just flags the tx as a tip so
 *                              the confirm scan can distinguish it from a bare send.)
 *
 * `op_return_raw` (the value passed to Cashtab BIP21) is the serialized script
 * WITHOUT the leading 0x6a, matching the convention in lib/opReturnEncode.js —
 * Cashtab prepends OP_RETURN itself.
 *
 * The content hash is the "proof of writing": the backend never trusts a
 * client-sent hash; it recomputes sha256 over the stored bytes and compares to
 * the on-chain value.
 */

import { Script, OP_RETURN, OP_0, pushBytesOp, sha256, toHex, fromHex } from 'ecash-lib'

/** Bare push opcode for a small int N (OP_1..OP_16 == 0x50 + N). Used for the action. */
const opN = (n) => 0x50 + n

/**
 * 4-byte LOKAD prefix.
 *
 * The default is the LAUNCH value "POWR" (0x504f5752) — the exact bytes Cashtab
 * keys its parser off (see docs/cashtab-powr-integration.md). This is what every
 * environment emits unless explicitly overridden.
 *
 * A test/staging environment that must NOT pollute the real POWR index can opt
 * back to the old testing tag "PROW" (0x50524f57) by setting
 * NEXT_PUBLIC_POW_LOKAD_HEX=50524f57 there.
 *
 * The override MUST be NEXT_PUBLIC_ so the browser encoder and the server decoder
 * read the SAME value (a server-only env would make the client emit one tag while
 * the server expected another — a silent verify mismatch).
 */
const DEFAULT_LOKAD_HEX = '504f5752' // "POWR" — production launch tag
function resolveLokadHex() {
  const env = (process.env.NEXT_PUBLIC_POW_LOKAD_HEX ?? '').trim().toLowerCase()
  return /^[0-9a-f]{8}$/.test(env) ? env : DEFAULT_LOKAD_HEX
}
export const FEED_LOKAD = fromHex(resolveLokadHex())
// The same tag as a lowercase hex string — the form Chronik's LOKAD-ID index
// and websocket subscriptions key off (ws.subscribeToLokadId). Same env
// resolution as FEED_LOKAD so the browser watcher always tracks the tag the
// encoder is emitting.
export const FEED_LOKAD_HEX = resolveLokadHex()

export const FEED_VERSION = 0

export const FEED_ACTION = Object.freeze({
  POST: 1,
  REPLY: 2,
  QUOTE: 3,
  REPOST: 4,
  LIKE: 5,
  PUBLISH: 6,
  UNLOCK: 7,
  AUTH: 8,
  HANDLE: 9,
  // Article comments — on-chain-distinct from feed post/reply so a chain observer
  // (and Cashtab) can tell "commented on an article" from "posted to the feed".
  COMMENT: 10, // top-level comment on an article (pays the article author 94/6)
  COMMENT_REPLY: 11, // reply to a comment (pays the parent comment's author 94/6)
  // Pocket delegation — rides the wallet→pocket FUNDING payment. The payer
  // (main wallet, tx.inputs[0]) commits the 33-byte compressed pubkey of its
  // browser-held spending key, so the wallet↔pocket link is publicly
  // reconstructable from chain alone. Additive action: deployed decoders that
  // don't know OP_12 simply return null for it.
  DELEGATE: 12,
  // Direct author tip — a bare marker (like UNLOCK) riding a single-output
  // payment straight to an author's payout address. Unlike a like, a tip targets
  // the PERSON, not a post (no targetTxid), pays 100% to the author (no platform
  // fee), and is repeatable. Additive action: older decoders return null for it.
  TIP: 13,
})

const MIN_ACTION = 1
const MAX_ACTION = 13

// Actions that reference another tx (its txid rides in the OP_RETURN before the
// optional content hash). post/publish/unlock/auth/comment reference nothing.
const CARRIES_TARGET = new Set([
  FEED_ACTION.REPLY,
  FEED_ACTION.QUOTE,
  FEED_ACTION.REPOST,
  FEED_ACTION.LIKE,
  FEED_ACTION.COMMENT_REPLY, // targets the parent comment's txid
])

// Actions that carry the author's own content (and thus a content hash). Repost
// and like re-surface someone else's post; unlock/auth carry no content. Publish
// commits the sha256 of the article body — its "proof of writing". Comments and
// comment-replies commit their own text the same way a post/reply does.
const CARRIES_HASH = new Set([
  FEED_ACTION.POST,
  FEED_ACTION.REPLY,
  FEED_ACTION.QUOTE,
  FEED_ACTION.PUBLISH,
  FEED_ACTION.COMMENT,
  FEED_ACTION.COMMENT_REPLY,
])

// Actions that carry a 36-byte ASCII UUID: auth (login challenge nonce) and
// handle (the pending_mints id that ties the mint payment to the reserved handle).
const CARRIES_NONCE = new Set([FEED_ACTION.AUTH, FEED_ACTION.HANDLE])

// Actions that carry a 33-byte compressed secp256k1 pubkey: delegate (the
// Pocket spending key the funding wallet is publicly endorsing).
const CARRIES_PUBKEY = new Set([FEED_ACTION.DELEGATE])

const TXID_BYTES = 32
const HASH_BYTES = 32
const NONCE_BYTES = 36
const PUBKEY_BYTES = 33

function utf8(str) {
  return new TextEncoder().encode(typeof str === 'string' ? str : '')
}

/** sha256 of the exact UTF-8 bytes of `content`, as lowercase hex. */
export function contentHashHex(content) {
  return toHex(sha256(utf8(content)))
}

function isHex(str, byteLen) {
  return (
    typeof str === 'string' &&
    new RegExp(`^[0-9a-fA-F]{${byteLen * 2}}$`).test(str.trim())
  )
}

/**
 * Build the `op_return_raw` hex for a POWR action.
 * @param {object} args
 * @param {number} args.action              one of FEED_ACTION
 * @param {string} [args.targetTxid]        64-hex referenced txid (required for
 *                                          reply/quote/repost/like). `parentTxid`
 *                                          is accepted as an alias.
 * @param {string} [args.parentTxid]        alias for targetTxid
 * @param {string} [args.contentHash]       64-hex sha256 of the content (required
 *                                          for post/reply/quote/publish)
 * @param {string} [args.nonce]             36-char ASCII UUID (required for auth)
 * @param {string} [args.pubkey]            66-hex compressed pubkey (required for
 *                                          delegate)
 * @returns {string} lowercase hex of the script WITHOUT the leading 0x6a
 */
export function encodeFeedOpReturnRaw({ action, targetTxid, parentTxid, contentHash, nonce, pubkey }) {
  if (!Number.isInteger(action) || action < MIN_ACTION || action > MAX_ACTION) {
    throw new Error(`Unsupported POWR action: ${action}`)
  }

  const ops = [OP_RETURN, pushBytesOp(FEED_LOKAD), OP_0, opN(action)]

  if (CARRIES_TARGET.has(action)) {
    const target = targetTxid ?? parentTxid
    if (!isHex(target, TXID_BYTES)) {
      throw new Error('targetTxid must be 32-byte hex for this action')
    }
    ops.push(pushBytesOp(fromHex(target.trim().toLowerCase())))
  }

  if (CARRIES_HASH.has(action)) {
    if (!isHex(contentHash, HASH_BYTES)) {
      throw new Error('contentHash must be 32-byte hex')
    }
    ops.push(pushBytesOp(fromHex(contentHash.trim().toLowerCase())))
  }

  if (CARRIES_NONCE.has(action)) {
    const bytes = utf8(nonce)
    if (bytes.length !== NONCE_BYTES) {
      throw new Error(`nonce must be a ${NONCE_BYTES}-byte UUID string`)
    }
    ops.push(pushBytesOp(bytes))
  }

  if (CARRIES_PUBKEY.has(action)) {
    if (!isHex(pubkey, PUBKEY_BYTES)) {
      throw new Error('pubkey must be 33-byte hex (compressed)')
    }
    ops.push(pushBytesOp(fromHex(pubkey.trim().toLowerCase())))
  }

  const bytecode = Script.fromOps(ops).bytecode
  // Strip the leading OP_RETURN (0x6a); Cashtab re-adds it.
  return toHex(bytecode.slice(1))
}

function readByte(hex, i) {
  return parseInt(hex.slice(i, i + 2), 16)
}

/** Decode a hex string of ASCII bytes back into a UTF-8 string. */
function hexToUtf8(hex) {
  const bytes = new Uint8Array(hex.length / 2)
  for (let j = 0; j < bytes.length; j++) {
    bytes[j] = parseInt(hex.slice(j * 2, j * 2 + 2), 16)
  }
  return new TextDecoder().decode(bytes)
}

/**
 * Decode a full OP_RETURN output script (hex, including leading 6a) into a POWR
 * commitment, or null if it isn't one of ours. `parentTxid` is kept as an alias
 * for `targetTxid` so existing callers keep working; `contentHash` is null for
 * repost/like/unlock/auth; `nonce` is the ASCII UUID for auth (else null);
 * `pubkey` is the 66-hex compressed pubkey for delegate (else null).
 * @param {string} scriptHex
 * @returns {{ version: number, action: number, targetTxid: string | null, parentTxid: string | null, contentHash: string | null, nonce: string | null, pubkey: string | null } | null}
 */
export function decodeFeedOpReturn(scriptHex) {
  if (typeof scriptHex !== 'string') return null
  const hex = scriptHex.trim().replace(/^0x/i, '').toLowerCase().replace(/\s+/g, '')
  if (hex.length < 4 || !hex.startsWith('6a')) return null

  let i = 2

  const readPush = () => {
    if (i + 2 > hex.length) return null
    const op = readByte(hex, i)
    i += 2
    // Only bare 1..75 byte pushes are used in this protocol.
    if (op < 0x01 || op > 0x4b) return null
    const len = op
    if (i + len * 2 > hex.length) return null
    const data = hex.slice(i, i + len * 2)
    i += len * 2
    return data
  }

  // LOKAD prefix push
  const lokad = readPush()
  if (lokad !== toHex(FEED_LOKAD)) return null

  // Version: bare OP_0 (0x00)
  if (i + 2 > hex.length) return null
  if (readByte(hex, i) !== OP_0) return null
  i += 2
  const version = 0

  // Action: bare OP_N opcode (OP_1..OP_12)
  if (i + 2 > hex.length) return null
  const action = readByte(hex, i) - 0x50
  i += 2
  if (action < MIN_ACTION || action > MAX_ACTION) return null

  let targetTxid = null
  if (CARRIES_TARGET.has(action)) {
    targetTxid = readPush()
    if (targetTxid == null || targetTxid.length !== TXID_BYTES * 2) return null
  }

  let contentHash = null
  if (CARRIES_HASH.has(action)) {
    contentHash = readPush()
    if (contentHash == null || contentHash.length !== HASH_BYTES * 2) return null
  }

  let nonce = null
  if (CARRIES_NONCE.has(action)) {
    const nonceHex = readPush()
    if (nonceHex == null || nonceHex.length !== NONCE_BYTES * 2) return null
    nonce = hexToUtf8(nonceHex)
  }

  let pubkey = null
  if (CARRIES_PUBKEY.has(action)) {
    pubkey = readPush()
    if (pubkey == null || pubkey.length !== PUBKEY_BYTES * 2) return null
  }

  return { version, action, targetTxid, parentTxid: targetTxid, contentHash, nonce, pubkey }
}
