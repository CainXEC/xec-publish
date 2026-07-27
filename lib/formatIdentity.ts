// =============================================================================
//  lib/formatIdentity.ts — the product's core byline rule, in ONE place.
//
//  An account's live display identity is its "@handle" if it holds one, else its
//  raw eCash address. This is the single definition every byline routes through
//  (authHelpers.identity, the /api/me identity, feed + comment post bylines, the
//  dashboard header) so the same account renders the same string everywhere.
//
//  Scope: this owns ONLY the handle-vs-address decision. Call sites with a richer
//  fallback than the bare address — "a collector", "a reader", an account id, or
//  a null-preserving chain — keep their own fallback and are intentionally not
//  folded in here.
// =============================================================================

export function formatIdentity(
  handle: string | null | undefined,
  address: string | null | undefined,
): string {
  const h = typeof handle === "string" ? handle.trim() : "";
  return h ? `@${h}` : address ?? "";
}
