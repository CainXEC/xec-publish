// =============================================================================
//  translateStore — remembers the translations the viewer has ACTIVATED, so a
//  translation FOLLOWS its content instead of resetting to the original.
//
//  Two layers:
//
//  1. In-memory (per-tab) — the full /api/translate payload, keyed by
//     `${kind}:${id}` (e.g. "feed:<txid>", "article:<slug>", "comment:<id>").
//     Lets every TranslateButton re-apply a live translation instantly across
//     in-app navigation / re-render (click into a post's thread and it stays
//     translated). Cleared on a full page reload — cheap, flicker-free.
//
//  2. Durable (localStorage), ARTICLES ONLY — a tiny record per slug:
//     { lang, title }. This is what makes an article STAY translated for you
//     across reloads and future visits until you revert it: on mount the button
//     re-fetches that language from the server (served from Redis — no new API
//     spend, it's the same shared cache) and the front-page rail shows the
//     translated title. We persist only the language + the (small) title, never
//     the article body, so there's no storage-quota risk. Scoped to articles on
//     purpose: feed posts keep the in-memory layer only, so a reload doesn't
//     fire a burst of re-fetches for every translated post in the feed.
// =============================================================================

const store = new Map()

const keyOf = (kind, id) => `${kind}:${String(id)}`

/** The stored /api/translate payload for this item, or null (in-memory). */
export function getTranslation(kind, id) {
  if (!kind || id == null) return null
  return store.get(keyOf(kind, id)) || null
}

/** Remember a translation the viewer activated (the full /api/translate data). */
export function setTranslation(kind, id, data) {
  if (!kind || id == null || !data) return
  store.set(keyOf(kind, id), data)
}

/** Forget it (viewer switched back to the original). */
export function clearTranslation(kind, id) {
  if (!kind || id == null) return
  store.delete(keyOf(kind, id))
}

// ---- durable article layer (localStorage) ---------------------------------

const A_KEY = 'pow_tr_articles' // { [slug]: { lang, title } }
// Fired whenever the durable article map changes, so the front-page rail can
// re-read it and swap titles live (same tab). Cross-tab updates ride the native
// `storage` event.
const A_EVENT = 'pow-translate-articles'

function readArticles() {
  if (typeof window === 'undefined') return {}
  try {
    return JSON.parse(window.localStorage.getItem(A_KEY) || '{}') || {}
  } catch {
    return {}
  }
}

function writeArticles(obj) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(A_KEY, JSON.stringify(obj))
  } catch {
    /* quota / private mode — the in-memory layer still works this session */
  }
  try {
    window.dispatchEvent(new Event(A_EVENT))
  } catch {
    /* ignore */
  }
}

export const ARTICLE_INTENTS_EVENT = A_EVENT

/** The viewer's durable translation choice for an article slug, or null. */
export function getArticleIntent(slug) {
  if (!slug) return null
  return readArticles()[String(slug)] || null
}

/** All durable article intents, as a plain { slug: { lang, title } } object. */
export function getAllArticleIntents() {
  return readArticles()
}

/** Persist the viewer's choice to keep an article translated. */
export function setArticleIntent(slug, { lang, title } = {}) {
  if (!slug || !lang) return
  const obj = readArticles()
  const key = String(slug)
  obj[key] = { lang, title: title || obj[key]?.title || '' }
  writeArticles(obj)
}

/** Drop the durable choice (viewer reverted to the original). */
export function clearArticleIntent(slug) {
  if (!slug) return
  const obj = readArticles()
  const key = String(slug)
  if (obj[key]) {
    delete obj[key]
    writeArticles(obj)
  }
}

// ---- durable SHORT-CONTENT layer (localStorage) — feed posts / comments -----
//  Feed posts and comments are tweet-length, so — unlike articles, whose large
//  bodies we deliberately never persist — we can store the TRANSLATED TEXT itself.
//  That's the whole win of "Option B": a translation you activated comes back
//  INSTANTLY on reload (re-applied from here on mount, NO re-fetch → no request
//  burst, no per-post round trip). Per-item (keyed `${kind}:${id}`), so ONLY the
//  posts you translated come back translated; untranslated foreign posts are
//  untouched. Capped LRU so the store can't grow without bound.
const F_KEY = 'pow_tr_short' // { [`${kind}:${id}`]: { lang, data, ts } }
const F_MAX = 200 // ~200 short translations kept; the oldest are evicted

function readShort() {
  if (typeof window === 'undefined') return {}
  try {
    return JSON.parse(window.localStorage.getItem(F_KEY) || '{}') || {}
  } catch {
    return {}
  }
}

function writeShort(obj) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(F_KEY, JSON.stringify(obj))
  } catch {
    /* quota / private mode — the in-memory layer still works this session */
  }
}

/** The viewer's durable translation for a short item (feed post / comment), or null. */
export function getShortTranslation(kind, id) {
  if (!kind || id == null) return null
  return readShort()[keyOf(kind, id)] || null
}

/** Persist a short-content translation durably (the full /api/translate payload —
 *  it's small). LRU-capped: the least-recently-set entries are evicted past F_MAX. */
export function setShortTranslation(kind, id, data) {
  if (!kind || id == null || !data) return
  const obj = readShort()
  obj[keyOf(kind, id)] = { lang: data.lang || null, data, ts: Date.now() }
  const keys = Object.keys(obj)
  if (keys.length > F_MAX) {
    keys
      .sort((a, b) => (obj[a]?.ts || 0) - (obj[b]?.ts || 0))
      .slice(0, keys.length - F_MAX)
      .forEach((k) => delete obj[k])
  }
  writeShort(obj)
}

/** Drop the durable short-content translation (viewer reverted to the original). */
export function clearShortTranslation(kind, id) {
  if (!kind || id == null) return
  const obj = readShort()
  const k = keyOf(kind, id)
  if (obj[k]) {
    delete obj[k]
    writeShort(obj)
  }
}
