// =============================================================================
//  lib/reactions.js — the feed's emoji reaction palette + polarity.
//
//  Feed posts are reacted to with one of a FIXED set of emoji, each a flat 100
//  XEC on-chain payment (the same OP_5 "like" tx underneath). Shared by the
//  client picker and the server prepare/confirm routes so the allowed set and
//  the "who gets paid" rule live in exactly one place.
//
//  Polarity: most emoji pay the post's author 94/6 (like the old ♥ like). A
//  "downvote" (👎) pays the PLATFORM 100% instead — you shouldn't fund what you
//  dislike. PLATFORM_PAID is the extensible list; add more here to flag them
//  platform-paid without touching the payment/verify code.
// =============================================================================

// Display order = picker order (palette A).
export const REACTIONS = ['❤️', '😂', '🔥', '🙏', '💯', '👍', '👎', '🤔']

const REACTION_SET = new Set(REACTIONS)

/** A legacy ♥ like (feed_events.emoji NULL) renders as this. */
export const DEFAULT_REACTION = '❤️'

/** True when `e` is exactly one of the allowed reaction emoji. The server
 *  validates with this before storing, so only canonical strings reach the DB. */
export function isReaction(e) {
  return typeof e === 'string' && REACTION_SET.has(e)
}

/** Emoji whose 100 XEC goes 100% to the platform instead of the author. */
export const PLATFORM_PAID = new Set(['👎'])

/** 'platform' → the whole payment goes to the platform (a downvote);
 *  'author'   → the usual 94/6 author split. */
export function payeeFor(emoji) {
  return PLATFORM_PAID.has(emoji) ? 'platform' : 'author'
}
