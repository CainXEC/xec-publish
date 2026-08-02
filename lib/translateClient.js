// =============================================================================
//  translateClient — a tiny client helper to request a translation payload from
//  /api/translate outside the TranslateButton (which owns the interactive flow).
//
//  Used to RE-translate an article the instant it unlocks: the reader translated
//  the public preview, so the active translation covers only the public bytes.
//  After paying, the full body appears under that stale short translation and the
//  unlock looks empty. The caller shows the untranslated full body immediately,
//  then swaps in this fresh full-scope translation when it lands.
// =============================================================================

/** POST /api/translate and return the payload ({translated, title?, lang}) or null. */
export async function fetchTranslation(kind, id, lang) {
  if (!kind || !id || !lang) return null
  try {
    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind, id, lang }),
    })
    const data = await res.json().catch(() => ({}))
    return res.ok && data?.ok ? data : null
  } catch {
    return null
  }
}
