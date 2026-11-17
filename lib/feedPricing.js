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
import { extractXPostId } from '@/lib/xLinks'

export const FEED_MIN_XEC = 100
export const FEED_MAX_CHARS = 2000

// A YouTube embed costs a flat premium ON TOP of the per-character price. Video is
// the one media exception on an ideas-first platform, so embedding it is a
// deliberate, pricier choice than plain text. Applied ONLY when the post actually
// RENDERS an embed — a feed post, quote, reply, or top-level forum post that
// carries a YouTube link — never an article comment (those don't embed). Computed
// in this ONE function so the client build and the server prepare/confirm always
// agree on the amount (a mismatch would fail on-chain verification).
export const FEED_YOUTUBE_SURCHARGE_XEC = 1000

// An embedded X post (text + images/video card) costs the SAME flat premium, for
// the same reason: it's the other media exception. Charged per embed kind, so a
// post carrying both a YouTube link and an X link (two embeds) pays both.
export const FEED_X_EMBED_SURCHARGE_XEC = 1000

// Actions whose posts render a YouTube / X embed. Accepts both the client's string
// form ('post'/'reply'/'quote') and the server's FEED_ACTION numbers (1=POST,
// 2=REPLY, 3=QUOTE). Article comments (no action passed) are excluded.
const EMBED_ACTIONS = new Set(['post', 'reply', 'quote', 1, 2, 3])

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
 * @param {{ action?: string|number, pollOptions?: Array<string|{text?: string}> }} [opts]
 *   `action` gates the YouTube surcharge to posts that actually embed (post/quote/
 *   top-forum-post, not replies/comments); omit for comment pricing. `pollOptions`
 *   are a poll's choices — their characters are billed ON TOP of the question
 *   (`content`), so a poll pays for its full text. Pass the SAME (server-normalized)
 *   options at build (prepare) and verify (confirm) so the amount always agrees.
 * @returns {{ ok: true, chars: number, pollChars: number, costXec: number, youtube: boolean, xEmbed: boolean } | { ok: false, error: string, chars: number }}
 */
export function priceFeedPost(content, { action, pollOptions } = {}) {
  const text = typeof content === 'string' ? content : ''
  const chars = countChars(text)

  if (text.trim().length === 0) {
    return { ok: false, error: 'Post cannot be empty', chars }
  }
  if (chars > FEED_MAX_CHARS) {
    return { ok: false, error: `Post exceeds ${FEED_MAX_CHARS} characters`, chars }
  }

  // A poll's choices bill their characters too (the question is `content`, counted
  // above). Accepts ['a','b'] or [{ text: 'a' }, …]. `chars` stays the body count
  // (for the composer counter + cap); only the cost folds in the choices.
  const pollChars = Array.isArray(pollOptions)
    ? pollOptions.reduce((sum, o) => sum + countChars(typeof o === 'string' ? o : (o?.text ?? '')), 0)
    : 0

  const embeds = EMBED_ACTIONS.has(action)
  const youtube = embeds && extractYouTubeId(text) != null
  const xEmbed = embeds && extractXPostId(text) != null
  const costXec =
    Math.max(FEED_MIN_XEC, chars + pollChars) +
    (youtube ? FEED_YOUTUBE_SURCHARGE_XEC : 0) +
    (xEmbed ? FEED_X_EMBED_SURCHARGE_XEC : 0)
  return { ok: true, chars, pollChars, costXec, youtube, xEmbed }
}
