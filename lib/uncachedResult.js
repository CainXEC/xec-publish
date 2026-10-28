// Hand a result back from an unstable_cache'd function WITHOUT caching it.
//
// unstable_cache only stores what its function RETURNS — a throw is never cached
// (and on a background refresh, the last good entry is kept). So a function whose
// lookup failed throws its best-effort result wrapped in this, and the caller
// unwraps it with serveUncached(): this request still gets an answer, and the
// next one retries the lookup instead of every reader being served the failure
// (e.g. "0 unlocks, 0 comments", or a 404) for the whole revalidate window.

export class UncachedResult extends Error {
  constructor(value, reason = 'a lookup failed') {
    super(`not cached: ${reason}`)
    this.name = 'UncachedResult'
    this.value = value
  }
}

/** Await a cached call; an UncachedResult it threw becomes its value. */
export async function serveUncached(promise) {
  try {
    return await promise
  } catch (e) {
    if (e instanceof UncachedResult) return e.value
    throw e
  }
}
