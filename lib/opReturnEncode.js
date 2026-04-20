/**
 * OP_RETURN payload for paywall BIP21 `op_return_raw` (Cashtab): one push of UTF-8 UUID (36 bytes).
 * Script fragment is push opcode + raw bytes (no leading OP_RETURN 0x6a — that is added by the wallet).
 */

const OP_PUSHDATA1 = 0x4c

function utf8Bytes(str) {
  return new TextEncoder().encode(str)
}

function bytesToHex(bytes) {
  let out = ''
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0')
  }
  return out
}

function hexToBytes(hex) {
  const h = hex.replace(/\s+/g, '')
  if (h.length % 2 !== 0) return null
  const out = new Uint8Array(h.length / 2)
  for (let i = 0; i < h.length; i += 2) {
    const v = parseInt(h.slice(i, i + 2), 16)
    if (Number.isNaN(v)) return null
    out[i / 2] = v
  }
  return out
}

/**
 * @param {string} postId — 36-char UUID (e.g. "d66cb66c-debd-4700-8228-15627f4ca434")
 * @returns {string} lowercase hex: 1-byte push length + UTF-8 bytes of UUID (e.g. "03616263" for "abc")
 */
export function encodePostIdOpReturnRaw(postId) {
  if (typeof postId !== 'string') {
    throw new TypeError('postId must be a string')
  }
  const bytes = utf8Bytes(postId)
  if (bytes.length !== 36) {
    throw new Error('postId must be exactly 36 UTF-8 bytes (standard UUID string)')
  }
  const pushOpcode = bytes.length.toString(16).padStart(2, '0')
  return pushOpcode + bytesToHex(bytes)
}

/**
 * Decode first push after OP_RETURN from full output script hex.
 * @param {string} scriptHex — full script (e.g. "6a24..." with 0x6a = OP_RETURN)
 * @returns {string | null} UTF-8 payload or null
 */
export function decodeOpReturnToPostId(scriptHex) {
  if (scriptHex == null || typeof scriptHex !== 'string') return null
  const hex = scriptHex.trim().replace(/^0x/i, '').toLowerCase().replace(/\s+/g, '')
  if (hex.length < 6 || !hex.startsWith('6a')) return null

  let i = 2
  const readByte = () => {
    if (i + 2 > hex.length) return null
    const v = parseInt(hex.slice(i, i + 2), 16)
    i += 2
    return Number.isNaN(v) ? null : v
  }

  const op = readByte()
  if (op == null) return null

  let dataLen
  if (op >= 0x01 && op <= 0x4b) {
    dataLen = op
  } else if (op === OP_PUSHDATA1) {
    const lenB = readByte()
    if (lenB == null) return null
    dataLen = lenB
  } else {
    return null
  }

  if (i + dataLen * 2 > hex.length) return null
  const dataHex = hex.slice(i, i + dataLen * 2)
  const bytes = hexToBytes(dataHex)
  if (!bytes) return null
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}
