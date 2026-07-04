/**
 * Feed OP_RETURN commitment protocol ("Proof of Writing" paid feed).
 *
 * On-chain layout of the OP_RETURN output script:
 *
 *   OP_RETURN                 (0x6a — added by Cashtab, NOT part of op_return_raw)
 *   <push 4> "PROW"           LOKAD prefix so indexers can filter feed txs
 *   OP_0                      protocol version (bare opcode, == 0)
 *   OP_N                      action as a bare opcode: OP_1 = post, OP_2 = reply
 *                             (OP_3/4/5 reserved: quote/repost/like)
 *   [<push 32> parentTxid]    reply only — the immediate parent's txid (display order)
 *   <push 32> contentHash     sha256 of the exact stored UTF-8 content bytes
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

/** 4-byte LOKAD prefix: ASCII "PROW". */
export const FEED_LOKAD = fromHex('50524f57')

export const FEED_VERSION = 0

export const FEED_ACTION = Object.freeze({
  POST: 1,
  REPLY: 2,
  // Reserved for the fast-follow, not yet handled by v1 verify/insert:
  QUOTE: 3,
  REPOST: 4,
  LIKE: 5,
})

const TXID_BYTES = 32
const HASH_BYTES = 32

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
 * Build the `op_return_raw` hex for a feed action.
 * @param {object} args
 * @param {number} args.action              FEED_ACTION.POST or FEED_ACTION.REPLY
 * @param {string} [args.parentTxid]        64-hex parent txid (required for REPLY)
 * @param {string} args.contentHash         64-hex sha256 of the content
 * @returns {string} lowercase hex of the script WITHOUT the leading 0x6a
 */
export function encodeFeedOpReturnRaw({ action, parentTxid, contentHash }) {
  if (action !== FEED_ACTION.POST && action !== FEED_ACTION.REPLY) {
    throw new Error(`Unsupported feed action: ${action}`)
  }
  if (!isHex(contentHash, HASH_BYTES)) {
    throw new Error('contentHash must be 32-byte hex')
  }

  const ops = [OP_RETURN, pushBytesOp(FEED_LOKAD), OP_0, opN(action)]

  if (action === FEED_ACTION.REPLY) {
    if (!isHex(parentTxid, TXID_BYTES)) {
      throw new Error('parentTxid must be 32-byte hex for a reply')
    }
    ops.push(pushBytesOp(fromHex(parentTxid.trim().toLowerCase())))
  }

  ops.push(pushBytesOp(fromHex(contentHash.trim().toLowerCase())))

  const bytecode = Script.fromOps(ops).bytecode
  // Strip the leading OP_RETURN (0x6a); Cashtab re-adds it.
  return toHex(bytecode.slice(1))
}

function readByte(hex, i) {
  return parseInt(hex.slice(i, i + 2), 16)
}

/**
 * Decode a full OP_RETURN output script (hex, including leading 6a) into a feed
 * commitment, or null if it isn't one of ours.
 * @param {string} scriptHex
 * @returns {{ version: number, action: number, parentTxid: string | null, contentHash: string } | null}
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

  // Action: bare OP_N opcode (OP_1..OP_5)
  if (i + 2 > hex.length) return null
  const action = readByte(hex, i) - 0x50
  i += 2
  if (action < 1 || action > 5) return null

  let parentTxid = null
  if (action === FEED_ACTION.REPLY) {
    parentTxid = readPush()
    if (parentTxid == null || parentTxid.length !== TXID_BYTES * 2) return null
  }

  const contentHash = readPush()
  if (contentHash == null || contentHash.length !== HASH_BYTES * 2) return null

  return { version, action, parentTxid, contentHash }
}
