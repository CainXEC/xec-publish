/**
 * Tidy a feed post's body for its share CARD while PRESERVING line breaks — the
 * card is a picture of the post, so a bulleted or multi-line post must not
 * collapse into one run-on paragraph (which is what `replace(/\s+/g, ' ')` did:
 * `\s` eats newlines).
 *
 * - CRLF/CR → LF so line handling is uniform.
 * - Runs of spaces/tabs within a line collapse to one (mono cards can't afford
 *   accidental double-spacing), and spaces hugging a newline are trimmed.
 * - Three or more newlines cap at one blank line — a post can't push its own
 *   text off the card with vertical whitespace.
 * - Leading/trailing whitespace trimmed.
 *
 * The result still carries `\n`, so callers must render it with
 * `white-space: pre-wrap` (and transport it through a URL param, which
 * percent-encodes the newlines safely).
 */
export function normalizeOgText(raw) {
  return (typeof raw === 'string' ? raw : '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
