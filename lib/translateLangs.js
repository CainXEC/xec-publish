// Supported target languages for the AI "Translate" feature. This same list is
// the server-side allowlist (rejects any lang code not here, before it ever
// reaches the model) AND the client language picker. Keep codes lowercase.
export const TRANSLATE_LANGS = [
  { code: 'en', name: 'English', label: 'English' },
  { code: 'es', name: 'Spanish', label: 'Español' },
  { code: 'zh', name: 'Chinese (Simplified)', label: '中文' },
  { code: 'hi', name: 'Hindi', label: 'हिन्दी' },
  { code: 'ar', name: 'Arabic', label: 'العربية' },
  { code: 'pt', name: 'Portuguese', label: 'Português' },
  { code: 'fr', name: 'French', label: 'Français' },
  { code: 'de', name: 'German', label: 'Deutsch' },
  { code: 'ja', name: 'Japanese', label: '日本語' },
  { code: 'ko', name: 'Korean', label: '한국어' },
  { code: 'ru', name: 'Russian', label: 'Русский' },
  { code: 'it', name: 'Italian', label: 'Italiano' },
  { code: 'id', name: 'Indonesian', label: 'Bahasa Indonesia' },
  { code: 'tr', name: 'Turkish', label: 'Türkçe' },
]

const BY_CODE = new Map(TRANSLATE_LANGS.map((l) => [l.code, l]))

/** Normalize a BCP-47 tag ("en-US", "PT-BR") to a supported base code, or null. */
export function normalizeLang(input) {
  if (typeof input !== 'string') return null
  const base = input.trim().toLowerCase().split('-')[0]
  return BY_CODE.has(base) ? base : null
}

/** English name for the model prompt ("Spanish"), or null if unsupported. */
export function langName(code) {
  return BY_CODE.get(code)?.name ?? null
}
