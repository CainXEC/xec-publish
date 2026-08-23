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

import { extractYouTubeId } from '@/lib/youtubeLinks'

export const FEED_MIN_XEC = 100
export const FEED_MAX_CHARS = 2000

// A YouTube embed costs a flat premium ON TOP of the per-character price. Video is
// the one media exception on an ideas-first platform, so embedding it is a
// deliberate, pricier choice than plain text. Applied ONLY when the post actually
// RENDERS an embed — a feed post, quote, or top-level forum post that carries a
// YouTube link — never a reply or an article comment (those don't embed). Computed
// in this ONE function so the client build and the server prepare/confirm always
// agree on the amount (a mismatch would fail on-chain verification).
export const FEED_YOUTUBE_SURCHARGE_XEC = 1000

// Actions whose posts render a YouTube embed. Accepts both the client's string
// form ('post'/'quote') and the server's FEED_ACTION numbers (1=POST, 3=QUOTE).
// REPLY (2 / 'reply') and comments (no action passed) are excluded.
const YOUTUBE_EMBED_ACTIONS = new Set(['post', 'quote', 1, 3])

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
 * @param {{ action?: string|number }} [opts] The post's action, so a YouTube
 *   surcharge applies only where an embed renders (post/quote/top-forum-post, not
 *   replies/comments). Omit for comment pricing — comments never embed.
 * @returns {{ ok: true, chars: number, costXec: number, youtube: boolean } | { ok: false, error: string, chars: number }}
 */
export function priceFeedPost(content, { action } = {}) {
  const text = typeof content === 'string' ? content : ''
  const chars = countChars(text)

  if (text.trim().length === 0) {
    return { ok: false, error: 'Post cannot be empty', chars }
  }
  if (chars > FEED_MAX_CHARS) {
    return { ok: false, error: `Post exceeds ${FEED_MAX_CHARS} characters`, chars }
  }

  const youtube = YOUTUBE_EMBED_ACTIONS.has(action) && extractYouTubeId(text) != null
  const costXec = Math.max(FEED_MIN_XEC, chars) + (youtube ? FEED_YOUTUBE_SURCHARGE_XEC : 0)
  return { ok: true, chars, costXec, youtube }
}
