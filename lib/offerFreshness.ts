// =============================================================================
//  lib/offerFreshness.ts — one source of truth for when a handle offer goes
//  stale. Kept dependency-free (no db, no other lib) so both handleOffers.ts
//  and feedNotifications.js can import it without a circular dependency.
//
//  Expiry is a READ filter: everywhere open offers are surfaced or counted we
//  require updated_at >= the cutoff. An untouched bid simply stops appearing
//  after OFFER_TTL_DAYS; re-placing it (the upsert bumps updated_at) makes it
//  live again. No status write, no cron.
// =============================================================================

export const OFFER_TTL_DAYS = 90;

export function offerFreshnessCutoffIso(): string {
  return new Date(Date.now() - OFFER_TTL_DAYS * 86_400_000).toISOString();
}
