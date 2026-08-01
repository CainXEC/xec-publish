// =============================================================================
//  readerPrefetch — warm the reading pane's payload before the click lands.
//
//  Clicking a front-page headline opens the pane, which THEN fetches
//  /api/posts/reader/<slug> client-side — so the reader stares at "Turning the
//  page…" for a full round-trip (cached payload + a per-viewer entitlement
//  check). Hovering (desktop) or pressing (touch) a headline calls
//  prefetchReader(slug) to start that fetch early; HomeReader consumes the
//  warmed promise via takePrefetchedReader(slug) and paints as soon as it's in.
//
//  Per tab (same viewer → same entitlement, so caching the payload is safe) with
//  a short TTL so an unlock can't keep serving a stale locked payload. A failed
//  prefetch drops itself from the cache so the next hover retries.
// =============================================================================

const cache = new Map() // slug -> Promise<payload|null>
const TTL_MS = 30_000

export function prefetchReader(slug) {
  if (typeof window === 'undefined') return null
  const s = typeof slug === 'string' ? slug.trim() : ''
  if (!s) return null
  const existing = cache.get(s)
  if (existing) return existing

  const p = fetch(`/api/posts/reader/${encodeURIComponent(s)}`, { cache: 'no-store' })
    .then((r) => r.json())
    .then((j) => {
      // Don't cache a non-answer — let the next hover (or the pane's own load)
      // retry a fresh request instead of replaying a failure for 30s.
      if (!j || !j.ok) cache.delete(s)
      return j
    })
    .catch(() => {
      cache.delete(s)
      return null
    })

  cache.set(s, p)
  window.setTimeout(() => cache.delete(s), TTL_MS)
  return p
}

/** The warmed payload promise for this slug, or null. */
export function takePrefetchedReader(slug) {
  const s = typeof slug === 'string' ? slug.trim() : ''
  return s ? cache.get(s) || null : null
}
