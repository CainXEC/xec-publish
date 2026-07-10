// =============================================================================
//  grantReservation.ts
//  A grandfathered name stays reserved for its owner until they actually claim
//  it. Any claim_grants row that isn't 'claimed' yet blocks a PUBLIC (paid) mint
//  of that name — so an unclaimed grant can't be minted out from under its owner,
//  without needing a hand-maintained reserved_handles entry per grant.
//
//  (A 'claimed' grant already has a handles row, so it's caught as "taken".)
//  Expired/errored grants stay reserved by default — never auto-give-away a
//  grandfathered name; release specific ones by hand if ever needed. The one
//  place a granted name is *allowed* to mint is the claim flow (claimGrant.ts),
//  which is separate from every path that calls this.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

/** True if `sk` has an active (not-yet-'claimed') grant, i.e. reserved for its owner. */
export async function handleReservedByGrant(supabase: SupabaseClient, sk: string): Promise<boolean> {
  const skel = typeof sk === "string" ? sk.trim() : "";
  if (!skel) return false;
  const { data } = await supabase
    .from("claim_grants")
    .select("handle_skeleton")
    .eq("handle_skeleton", skel)
    .neq("status", "claimed")
    .limit(1);
  return (data?.length ?? 0) > 0;
}
