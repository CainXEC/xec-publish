// =============================================================================
//  xPostData.js — shape X's public post data (the syndication JSON react-tweet
//  fetches) into what an embed on POW is allowed to show. Runs on the SERVER
//  (app/api/x-post/[id]) so nothing it removes ever reaches a browser.
//
//  Three guards, each pure + unit-tested:
//    1. Markup neutralized. react-tweet renders tweet text through
//       dangerouslySetInnerHTML (to decode X's &amp;-style escapes). X already
//       escapes < and >, but this origin holds Pocket spending keys, so we don't
//       lean on that: EVERY string has any raw "<" / ">" swapped for the
//       single-code-point lookalikes ‹ ›. Length-preserving, so the entity
//       indices X sends (hashtags, mentions, urls) still line up.
//    2. Sensitive media withheld. A post (or its quoted post) X flags
//       possibly_sensitive keeps its text but loses every image/video field —
//       the card shows "media hidden, view on X" instead. This is the
//       illegal/abusive-image concern behind the site's no-images rule.
//    3. Trimmed. The reply-parent copy X bundles (`parent`) is never rendered.
// =============================================================================

const LT = '‹' // ‹
const GT = '›' // ›

function neutralize(value) {
  if (typeof value === 'string') {
    return value.indexOf('<') === -1 && value.indexOf('>') === -1
      ? value
      : value.replace(/</g, LT).replace(/>/g, GT)
  }
  if (Array.isArray(value)) return value.map(neutralize)
  if (value && typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) out[k] = neutralize(v)
    return out
  }
  return value
}

function withholdSensitiveMedia(t) {
  if (!t || !t.possibly_sensitive) return t
  const out = { ...t, pow_media_hidden: Boolean(t.mediaDetails?.length || t.photos?.length || t.video) }
  delete out.mediaDetails
  delete out.photos
  delete out.video
  delete out.card // link-preview card (its own image)
  return out
}

/**
 * The embed-safe copy of a syndication post, or null if `tweet` isn't a usable
 * post (missing / tombstone / malformed). Never mutates its input.
 */
export function prepareXPostForEmbed(tweet) {
  if (!tweet || typeof tweet !== 'object') return null
  if (typeof tweet.id_str !== 'string' || !/^\d{1,20}$/.test(tweet.id_str)) return null
  if (typeof tweet.text !== 'string' || !tweet.user || typeof tweet.user !== 'object') return null
  if (!Array.isArray(tweet.display_text_range)) return null

  const clean = neutralize(tweet) // a fresh deep copy — safe to edit below
  delete clean.parent
  const out = withholdSensitiveMedia(clean)
  if (out.quoted_tweet && typeof out.quoted_tweet === 'object') {
    out.quoted_tweet = withholdSensitiveMedia(out.quoted_tweet)
  }
  return out
}
