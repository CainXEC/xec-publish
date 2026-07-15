// =============================================================================
//  feedPoll.js — shared poll shape + normalization for the feed.
//
//  A poll is stored on a feed_posts row as card_kind='poll' with
//  card_meta = { options: [{ id, text }], eligibility: 'handle' | 'account' }.
//  The question is the post content. These helpers keep the composer, the
//  confirm insert, and the vote route agreeing on one shape — the server always
//  re-normalizes (assigns option ids, clamps/ dedupes) and never trusts a
//  client-sent structure verbatim.
// =============================================================================

export const POLL_MIN_OPTIONS = 2
export const POLL_MAX_OPTIONS = 4
export const POLL_OPTION_MAX_CHARS = 80
export const POLL_ELIGIBILITY = ['account', 'handle']

/**
 * Normalize a client-sent poll into the stored card_meta shape, or return null
 * if it can't make a valid poll (fewer than 2 distinct non-empty options).
 * Option ids are assigned here (o0, o1, …) so the client can't control them.
 */
export function normalizePoll(raw) {
  if (!raw || typeof raw !== 'object') return null
  const eligibility = raw.eligibility === 'handle' ? 'handle' : 'account'
  const rawOpts = Array.isArray(raw.options) ? raw.options : []
  const seen = new Set()
  const texts = []
  for (const o of rawOpts) {
    const text = String(o?.text ?? o ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, POLL_OPTION_MAX_CHARS)
    if (!text) continue
    const key = text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    texts.push(text)
    if (texts.length >= POLL_MAX_OPTIONS) break
  }
  if (texts.length < POLL_MIN_OPTIONS) return null
  return { eligibility, options: texts.map((text, i) => ({ id: `o${i}`, text })) }
}
