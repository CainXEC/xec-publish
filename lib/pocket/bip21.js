/**
 * The Pocket — BIP21 parser.
 *
 * The pocket spends by re-using the SAME payment intents Cashtab gets: every
 * prepare endpoint (and the client-built unlock) hands us a BIP21 string, and
 * the pocket turns it into concrete outputs to sign locally. One parser for
 * every flow means the pocket can never drift from what Cashtab would have
 * paid.
 *
 * Grammar (exactly what lib/paymentSplit.js emits):
 *   ecash:ADDR?amount=A[&addr=ADDR2&amount=B][&op_return_raw=HEX]
 * `amount` binds to the MOST RECENT address (the path address, then each
 * addr=). URLSearchParams would collapse the duplicate `amount` keys, so the
 * query is walked pair-by-pair in order.
 *
 * STRICT BY DESIGN: any unknown query key returns null — the caller then
 * routes the payment to Cashtab, which understands params this parser
 * doesn't. Money math is STRING math (never floats): "5.50" XEC → 550n sats.
 */

/**
 * XEC decimal string → satoshis (1 XEC = 100 sats). String math only.
 * @param {string} value
 * @returns {bigint | null} null when not a plain non-negative decimal with ≤2 places
 */
export function xecToSats(value) {
  const s = typeof value === 'string' ? value.trim() : ''
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null
  const [whole, frac = ''] = s.split('.')
  try {
    return BigInt(whole) * 100n + BigInt(frac.padEnd(2, '0') || '0')
  } catch {
    return null
  }
}

/**
 * @param {string} bip21
 * @returns {{ outputs: Array<{ address: string, sats: bigint }>, opReturnRaw: string | null, totalSats: bigint } | null}
 */
export function parseEcashBip21(bip21) {
  if (typeof bip21 !== 'string' || !bip21.trim()) return null
  const input = bip21.trim()

  const qIdx = input.indexOf('?')
  const path = qIdx === -1 ? input : input.slice(0, qIdx)
  const query = qIdx === -1 ? '' : input.slice(qIdx + 1)

  const pathAddr = normalizeAddress(path)
  if (!pathAddr) return null

  // outputs[i] = { address, sats|null }; `amount` fills the most recent one.
  const outputs = [{ address: pathAddr, sats: null }]
  let opReturnRaw = null

  if (query) {
    for (const pair of query.split('&')) {
      if (!pair) return null // "&&" or trailing "&" — not something we emit
      const eq = pair.indexOf('=')
      if (eq === -1) return null
      const key = pair.slice(0, eq)
      let value
      try {
        value = decodeURIComponent(pair.slice(eq + 1))
      } catch {
        return null
      }

      if (key === 'amount') {
        const last = outputs[outputs.length - 1]
        if (last.sats != null) return null // two amounts for one address
        const sats = xecToSats(value)
        if (sats == null || sats <= 0n) return null
        last.sats = sats
      } else if (key === 'addr') {
        const addr = normalizeAddress(value)
        if (!addr) return null
        outputs.push({ address: addr, sats: null })
      } else if (key === 'op_return_raw') {
        if (opReturnRaw != null) return null // one OP_RETURN per payment
        const hex = value.trim().toLowerCase()
        if (!/^[0-9a-f]{2,}$/.test(hex) || hex.length % 2 !== 0) return null
        opReturnRaw = hex
      } else {
        // Unknown param (label, message, token fields, future extensions):
        // refuse — let Cashtab, which understands it, handle the payment.
        return null
      }
    }
  }

  let totalSats = 0n
  for (const out of outputs) {
    if (out.sats == null) return null // every output needs an explicit amount
    totalSats += out.sats
  }

  return { outputs, opReturnRaw, totalSats }
}

/** Accepts bare or ecash:-prefixed p2pkh/p2sh cashaddr; returns the
 *  ecash:-prefixed lowercase form, or null. Character-set check only — the
 *  spend path's address encoder is the real validator. */
function normalizeAddress(value) {
  const s = String(value ?? '').trim().toLowerCase()
  const bare = s.replace(/^ecash:/, '')
  if (!/^[a-z0-9]{20,}$/.test(bare)) return null
  return `ecash:${bare}`
}
