/** True if HTML has non-empty visible text (for required validation). */
export function postBodyHasMeaningfulText(html) {
  if (!html || typeof html !== 'string') return false
  const text = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > 0
}
