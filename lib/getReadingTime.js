/**
 * Display label for stored `posts.reading_time_minutes`. Returns null if missing or under 1 minute.
 */
export function formatReadingTimeLabel(minutes) {
  const n = Number(minutes)
  if (!Number.isFinite(n) || n < 1) return null
  const m = Math.round(n)
  return m === 1 ? '1 min read' : `${m} min read`
}
