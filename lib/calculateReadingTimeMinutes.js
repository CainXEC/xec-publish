const WORDS_PER_MINUTE = 200
// CJK scripts (Chinese Han, Japanese Hiragana/Katakana, Korean Hangul) don't
// space-delimit words, so a whitespace split treats a whole paragraph as ONE
// "word" — a 3,000-character article was measuring as "1 word" and rounding
// down to a 1-minute read regardless of actual length. These scripts are
// conventionally measured in characters/minute instead; 300 sits in the
// commonly-cited 260–400 cpm range for silent reading.
const CJK_CHARS_PER_MINUTE = 300
const CJK_RANGE = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힣]/g

/**
 * Reading time in minutes from HTML body (strip tags, ceiling). Call with the
 * same body string you persist to `posts.body`.
 *
 * CJK characters and whitespace-delimited words (English or any other Latin/
 * Cyrillic/etc text mixed into the same article) are counted separately, each
 * at their own reading speed, then summed — so an article that's mostly
 * Chinese with an inline English term still gets a sane estimate for both
 * parts instead of one script's word-counting assumption silently breaking
 * on the other's text.
 */
export function calculateReadingTimeMinutes(body) {
  const text = String(body ?? '')
    .replace(/<div[^>]*data-paywall-break(?:="true")?[^>]*>\s*<\/div>/gi, '')
    .replace(/<[^>]*>/g, '')

  const cjkCount = (text.match(CJK_RANGE) || []).length
  // Strip CJK characters before the whitespace split so a run of them (which
  // has no spaces to split on) can't collapse into one giant "word" alongside
  // whatever Latin text surrounds it.
  const words = text.replace(CJK_RANGE, ' ').trim().split(/\s+/).filter(Boolean).length

  const minutes = words / WORDS_PER_MINUTE + cjkCount / CJK_CHARS_PER_MINUTE
  return Math.max(1, Math.ceil(minutes))
}
