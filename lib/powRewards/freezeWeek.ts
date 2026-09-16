// =============================================================================
//  lib/powRewards/freezeWeek.ts
//  Freeze a week's reward tally into the DB: compute the per-account allocation
//  (rolling in the prior week's carryover) and write pow_reward_epochs +
//  pow_reward_claims (status 'pending'). See docs/pow-token-migration-plan.md §5.
//
//  IDEMPOTENT: once an epoch is past 'open' (i.e. 'tallied'/'paying'/'done') a
//  re-run is a no-op that returns the existing claims — it will NOT re-tally or
//  clobber rows that may already be paid. `force` re-tallies an existing epoch
//  (use only before any payment has gone out).
//
//  WRITES the DB, but never sends tokens — that's payWeek.ts.
// =============================================================================

import { adminDb } from "@/lib/db";
import { weekBoundsFor, type WeekBounds } from "./isoWeek";
import { tallyWeekRevenue } from "./tallyWeek";
import { allocate, type RewardClaim } from "./allocate";

export interface FreezeResult {
  isoWeek: string;
  alreadyFrozen: boolean;
  poolAtoms: number;
  carryInAtoms: number;
  carryoverAtoms: number;
  totalFeeSats: number;
  claims: RewardClaim[];
}

/** ISO week key immediately before `b`. */
function priorWeekKey(b: WeekBounds): string {
  return weekBoundsFor(new Date(b.startUtc.getTime() - 1)).isoWeek;
}

export async function freezeWeek(
  bounds: WeekBounds,
  basePoolAtoms: number,
  opts: { force?: boolean } = {},
): Promise<FreezeResult> {
  const db = adminDb();
  const now = new Date().toISOString();

  const { data: existing } = await db
    .from("pow_reward_epochs")
    .select("*")
    .eq("iso_week", bounds.isoWeek)
    .maybeSingle();

  if (existing && !opts.force && existing.status !== "open") {
    // Already frozen — return what's there, don't re-tally (avoids clobbering sends).
    const { data: claims } = await db
      .from("pow_reward_claims")
      .select("account_id, fee_sats, allocation_atoms, to_address")
      .eq("iso_week", bounds.isoWeek);
    return {
      isoWeek: bounds.isoWeek,
      alreadyFrozen: true,
      poolAtoms: existing.pool_atoms,
      carryInAtoms: 0,
      carryoverAtoms: existing.carryover_atoms,
      totalFeeSats: existing.total_fee_sats ?? 0,
      claims: (claims ?? []).map((c) => ({
        accountId: c.account_id,
        feeSats: c.fee_sats,
        allocationAtoms: c.allocation_atoms,
        toAddress: c.to_address,
      })),
    };
  }

  // Roll in the prior week's leftover (remainder + sub-1-POW shares).
  const { data: prior } = await db
    .from("pow_reward_epochs")
    .select("carryover_atoms")
    .eq("iso_week", priorWeekKey(bounds))
    .maybeSingle();
  const carryIn = prior?.carryover_atoms ?? 0;

  const tally = await tallyWeekRevenue(bounds.startUtc, bounds.endUtc);
  const alloc = await allocate(tally, basePoolAtoms, carryIn);

  const { error: eErr } = await db.from("pow_reward_epochs").upsert(
    {
      iso_week: bounds.isoWeek,
      week_start: bounds.startUtc.toISOString(),
      week_end: bounds.endUtc.toISOString(),
      pool_atoms: basePoolAtoms,
      carryover_atoms: alloc.carryoverAtoms,
      total_fee_sats: tally.totalFeeSats,
      status: "tallied",
      computed_at: now,
      updated_at: now,
    },
    { onConflict: "iso_week" },
  );
  if (eErr) throw new Error(`freezeWeek epoch: ${eErr.message}`);

  if (alloc.claims.length) {
    const rows = alloc.claims.map((c) => ({
      iso_week: bounds.isoWeek,
      account_id: c.accountId,
      fee_sats: c.feeSats,
      allocation_atoms: c.allocationAtoms,
      to_address: c.toAddress,
      status: "pending",
      updated_at: now,
    }));
    const { error: cErr } = await db
      .from("pow_reward_claims")
      .upsert(rows, { onConflict: "iso_week,account_id" });
    if (cErr) throw new Error(`freezeWeek claims: ${cErr.message}`);
  }

  return {
    isoWeek: bounds.isoWeek,
    alreadyFrozen: false,
    poolAtoms: basePoolAtoms,
    carryInAtoms: carryIn,
    carryoverAtoms: alloc.carryoverAtoms,
    totalFeeSats: tally.totalFeeSats,
    claims: alloc.claims,
  };
}
