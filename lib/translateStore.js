// =============================================================================
//  translateStore — a tiny in-memory record of the translations the viewer has
//  ACTIVATED this session, keyed by `${kind}:${id}` (e.g. "feed:<txid>",
//  "article:<slug>", "comment:<id>").
//
//  WHY: translation state used to live only in the component that rendered the
//  Translate button, so it reset to the original whenever the same post was
//  re-rendered somewhere else — click into a post's thread and the translation
//  vanished. This store lets a translation FOLLOW its post: every TranslateButton
//  re-applies a stored translation on mount, so it stays translated across
//  in-app navigation and re-renders.
//
//  The server also caches every translation in Redis (keyed by content hash +
//  scope + language, shared across ALL users), so this is purely a client-side
//  convenience — it avoids a re-fetch/flicker and remembers the viewer's intent.
//  It's per-tab and in-memory: a full page reload starts fresh (deliberate — no
//  storage-quota risk from large translated articles).
// =============================================================================

const store = new Map()

const keyOf = (kind, id) => `${kind}:${String(id)}`

/** The stored /api/translate payload for this item, or null. */
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
