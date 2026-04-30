/** Plain-text length after stripping HTML tags (for body limits / validation). */
export function countPlainTextCharsFromHtml(html) {
  if (!html || typeof html !== 'string') return 0
  return html
    .replace(/<div[^>]*data-paywall-break(?:="true")?[^>]*>\s*<\/div>/gi, '')
    .replace(/<[^>]*>/g, '')
    .length
}
