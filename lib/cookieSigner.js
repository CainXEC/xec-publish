import { createHmac, timingSafeEqual } from 'node:crypto'

function getSecret() {
  const secret = process.env.COOKIE_SECRET
  if (!secret || typeof secret !== 'string' || !secret.trim()) {
    throw new Error('COOKIE_SECRET is not set')
  }
  return secret.trim()
}

/**
 * @param {string} postId
 * @param {string} txid
 * @returns {string} `{txid}.{hex_hmac}` where HMAC is SHA-256 over `${postId}${txid}`
 */
export function signCookieValue(postId, txid) {
  const secret = getSecret()
  const id = String(postId)
  const tx = String(txid).trim()
  if (!tx) {
    throw new Error('txid is required to sign unlock cookie')
  }
  const payload = `${id}${tx}`
  const sig = createHmac('sha256', secret).update(payload).digest('hex')
  return `${tx}.${sig}`
}

/**
 * @param {string} postId
 * @param {string | undefined} cookieValue
 * @returns {{ valid: boolean, txid: string }}
 */
export function verifyCookieValue(postId, cookieValue) {
  if (!cookieValue || typeof cookieValue !== 'string') {
    return { valid: false, txid: '' }
  }
  let secret
  try {
    secret = getSecret()
  } catch {
    return { valid: false, txid: '' }
  }

  const trimmed = cookieValue.trim()
  const dot = trimmed.indexOf('.')
  if (dot <= 0 || dot === trimmed.length - 1) {
    return { valid: false, txid: '' }
  }

  const txid = trimmed.slice(0, dot)
  const sigHex = trimmed.slice(dot + 1)
  if (!txid || !/^[0-9a-f]+$/i.test(sigHex)) {
    return { valid: false, txid: '' }
  }

  const expectedHex = createHmac('sha256', secret)
    .update(`${String(postId)}${txid}`)
    .digest('hex')

  if (sigHex.length !== expectedHex.length) {
    return { valid: false, txid: '' }
  }

  try {
    const a = Buffer.from(sigHex, 'hex')
    const b = Buffer.from(expectedHex, 'hex')
    if (a.length !== b.length) {
      return { valid: false, txid: '' }
    }
    const valid = timingSafeEqual(a, b)
    return { valid, txid: valid ? txid : '' }
  } catch {
    return { valid: false, txid: '' }
  }
}
