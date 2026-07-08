/**
 * Pay-to-post pricing for the feed.
 *
 * - 1 XEC per character (including spaces).
 * - Minimum 100 XEC (posts under 100 chars still cost 100 XEC).
 * - Hard cap of 2000 characters.
 *
 * Characters are counted by Unicode code point (`[...str].length`) so the count
 * matches what a user sees rather than UTF-16 surrogate units.
 */

export const FEED_MIN_XEC = 100
export const FEED_MAX_CHARS = 2000

// A like doubles as a tip: the author picks any whole XEC amount from the 100 XEC
// minimum up to a sane ceiling (guards against fat-finger / overflow input).
export const FEED_TIP_MIN_XEC = FEED_MIN_XEC
export const FEED_TIP_MAX_XEC = 1_000_000_000

/**
 * Validate a like/tip amount. Returns the whole-number XEC value, or null if the
 * input isn't a finite number within [FEED_TIP_MIN_XEC, FEED_TIP_MAX_XEC].
 * @param {number|string} input
 * @returns {number | null}
 */
export function normalizeTipXec(input) {
  const n = Number(input)
  if (!Number.isFinite(n)) return null
  const xec = Math.floor(n)
  if (xec < FEED_TIP_MIN_XEC || xec > FEED_TIP_MAX_XEC) return null
  return xec
}

/** Count characters by code point. */
export function countChars(content) {
  return typeof content === 'string' ? [...content].length : 0
}

/**
 * @param {string} content
 * @returns {{ ok: true, chars: number, costXec: number } | { ok: false, error: string, chars: number }}
 */
export function priceFeedPost(content) {
  const text = typeof content === 'string' ? content : ''
  const chars = countChars(text)

  if (text.trim().length === 0) {
    return { ok: false, error: 'Post cannot be empty', chars }
  }
  if (chars > FEED_MAX_CHARS) {
    return { ok: false, error: `Post exceeds ${FEED_MAX_CHARS} characters`, chars }
  }

  const costXec = Math.max(FEED_MIN_XEC, chars)
  return { ok: true, chars, costXec }
}
