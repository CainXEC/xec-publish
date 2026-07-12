// =============================================================================
//  lib/ecash/chronikBudget.ts — a stopwatch for display-path Chronik reads.
//
//  Chronik failover only rotates endpoints on ERRORS; an endpoint that accepts
//  the connection and then HANGS holds the caller hostage until the transport
//  gives up (30s+). Pages that merely DISPLAY chain state shouldn't wait that
//  out — every such page already has a good-enough fallback (a cached binding,
//  the last-known list, a "refreshing" note), so the missing piece is only the
//  budget: ask Chronik, and past the deadline resolve with the fallback.
//
//  When Chronik is healthy (~100–300ms) the deadline never fires and behavior
//  is byte-identical. The losing request is left to finish in the void — no
//  cancellation, no side effects, its answer just isn't waited for.
//
//  NEVER use this on money paths (verify-payment, mint, unlock verification):
//  a stalled indexer should make a purchase WAIT, never lie. Display only.
// =============================================================================

/** Race `work` against a deadline; resolve with `fallback` on timeout OR error.
 *  The generous defaults sit far above healthy Chronik latency — they exist to
 *  convert rare hangs into instant fallbacks, not to shave milliseconds. */
export async function chronikBudget<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work.catch(() => fallback),
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
