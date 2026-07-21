/**
 * Cut text to a length WITHOUT slicing a word in half, adding "…" only when
 * something was actually removed.
 *
 * Share cards are the one surface where a clumsy truncation is permanent and
 * public: whatever the card says is what gets embedded in someone else's
 * timeline forever. A post ending "…the whole point is that you can ver" reads
 * as a bug in the site, not as a preview.
 *
 * The ellipsis is INSIDE the budget (the result is never longer than `max`), so
 * this stays safe to use for hard limits like an OG description.
 *
 * A single word longer than the budget — an eCash address, a long URL — has no
 * space to back off to, so it's hard-cut rather than dropped: half an address is
 * more use to a reader than nothing at all. Same for scripts that don't space
 * their words; backing off to the last space could eat the entire string, so we
 * only accept a word boundary that keeps a reasonable share of the budget.
 */
const MIN_KEEP_RATIO = 0.6

export function truncateAtWord(text, max) {
  const s = typeof text === 'string' ? text : ''
  const limit = Number(max)
  if (!Number.isFinite(limit) || limit <= 0) return ''
  if (s.length <= limit) return s

  // Reserve the ellipsis, then back off to the last word boundary inside it —
  // unless the cut already lands on one (the next character dropped is a
  // space), in which case the last word is whole and backing off would throw
  // away a word for nothing.
  const hard = s.slice(0, limit - 1)
  const lastSpace = hard.lastIndexOf(' ')
  const landsClean = s[limit - 1] === ' '
  const cut =
    landsClean || lastSpace < Math.floor((limit - 1) * MIN_KEEP_RATIO)
      ? hard
      : hard.slice(0, lastSpace)

  // trimEnd also strips the space before a boundary cut, and any punctuation
  // spacing at a hard cut.
  return `${cut.trimEnd()}…`
}
