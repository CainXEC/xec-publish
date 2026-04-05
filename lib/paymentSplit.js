/** Strip ecash: prefix for use in BIP21 path or comparison helpers. */
export function stripEcashPrefix(addr) {
  if (!addr || typeof addr !== 'string') return ''
  return addr.replace(/^ecash:/i, '').trim()
}

/**
 * 5% platform fee: author gets floor(95%), platform gets remainder.
 * @param {number|string} priceXec
 * @returns {{ authorAmount: number, platformAmount: number } | null}
 */
export function computePaymentSplit(priceXec) {
  const price = Number(priceXec)
  if (!Number.isFinite(price) || price < 0) return null
  const authorAmount = Math.floor(price * 0.95)
  const platformAmount = price - authorAmount
  return { authorAmount, platformAmount }
}

/**
 * eCash BIP21 multi-output: primary address in path, extra output via addr + amount
 * (Cashtab / eCash extended BIP21).
 */
export function buildPaywallBip21(
  authorAddress,
  platformAddress,
  authorAmount,
  platformAmount,
) {
  const author = stripEcashPrefix(authorAddress)
  const platform = stripEcashPrefix(platformAddress)
  if (!author || !platform) return ''
  const aAmt = String(authorAmount)
  const pAmt = String(platformAmount)
  return `ecash:${author}?amount=${aAmt}&addr=${encodeURIComponent(platform)}&amount=${pAmt}`
}
