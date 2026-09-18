// =============================================================================
//  lib/powRewards/freezeWeek.ts
//  Turn a week's raw Contribution-Score components into POW allocations, and
//  freeze them into pow_reward_epochs / pow_reward_claims. See §22 of the plan.
//
//  Pipeline:
//    scoreWeek → per-component SHARE (user / component total) → weighted
//    contribution share (0.35/0.35/0.30) → renormalise to the active dimensions →
//    10% per-user cap (iterative redistribution) → × pool → floor to whole POW →
//    round the flooring leftover up to the closest sub-1 accounts → claims.
//
//  previewWeek() runs the whole pipeline WITHOUT writing; freezeWeek() writes.
//  Neither sends tokens — that's payWeek.ts. freezeWeek is idempotent (a re-run on
//  an already-frozen epoch is a no-op unless `force`).
// =============================================================================

import { adminDb } from "@/lib/db";
import { weekBoundsFor, type WeekBounds } from "./isoWeek";
import { loadConfig, type RewardConfig } from "./config";
import { scoreWeek, type Activity } from "./score";
import { contributionRows } from "./contribution";
import { primaryAddresses } from "./accounts";

export interface FrozenClaim {
  accountId: string;
  allocationAtoms: number;
  toAddress: string;
  economicScore: number;
  creationScore: number;
  engagementScore: number;
  contributionScore: number;
  capped: boolean;
  activity: Activity;
}
export interface WeekComputation {
  isoWeek: string;
  poolAtoms: number;
  carryInAtoms: number;
  distributableAtoms: number;
  carryoverAtoms: number;
  totals: { economic: number; creation: number; engagement: number; contribution: number };
  claims: FrozenClaim[];
  config: RewardConfig;
}
export interface FreezeResult extends WeekComputation {
  alreadyFrozen: boolean;
}

/** Cap each share at `cap` (fraction of pool), redistributing excess to the
 *  uncapped proportionally; iterate until stable. Input/҃output sum ≤ 1. */
function capShares(input: Map<string, number>, cap: number): { shares: Map<string, number>; capped: Set<string> } {
  const shares = new Map(input);
  const capped = new Set<string>();
  for (let iter = 0; iter < 1000; iter++) {
    const over = [...shares].filter(([k, v]) => !capped.has(k) && v > cap + 1e-12);
    if (over.length === 0) break;
    let excess = 0;
    for (const [k, v] of over) { excess += v - cap; shares.set(k, cap); capped.add(k); }
    const uncapped = [...shares].filter(([k]) => !capped.has(k));
    const uncappedSum = uncapped.reduce((a, [, v]) => a + v, 0);
    if (uncappedSum <= 0) break; // everyone capped — remainder simply won't distribute
    for (const [k, v] of uncapped) shares.set(k, v + excess * (v / uncappedSum));
  }
  return { shares, capped };
}

/** Compute the full allocation for a week (no DB writes). */
export async function computeWeek(bounds: WeekBounds, carryInAtoms: number, cfg: RewardConfig): Promise<WeekComputation> {
  const pool = cfg.weeklyPoolAtoms;
  const distributable = pool + carryInAtoms;
  const scores = await scoreWeek(bounds.startUtc, bounds.endUtc, cfg);

  const { rows, totalContribShareRaw, totals } = contributionRows(scores, cfg);

  if (rows.length === 0 || totalContribShareRaw <= 0) {
    return { isoWeek: bounds.isoWeek, poolAtoms: pool, carryInAtoms, distributableAtoms: distributable, carryoverAtoms: distributable, totals, claims: [], config: cfg };
  }

  // Normalise to sum 1 across active accounts, then cap.
  const shares = new Map<string, number>();
  for (const r of rows) shares.set(r.accountId, r.contribShareRaw / totalContribShareRaw);
  const { shares: capShare, capped } = capShares(shares, cfg.maxUserShare);

  // Primary addresses for payout.
  const addrs = await primaryAddresses(rows.map((r) => r.accountId));

  // rawPow = share × distributable; floor; then round leftover up to closest sub-1.
  interface Alloc { row: (typeof rows)[number]; toAddress: string; raw: number; floor: number; capped: boolean }
  const allocs: Alloc[] = [];
  for (const r of rows) {
    const toAddress = addrs.get(r.accountId);
    if (!toAddress) continue; // no primary address → skip, its share rolls forward
    const raw = (capShare.get(r.accountId) ?? 0) * distributable;
    allocs.push({ row: r, toAddress, raw, floor: Math.floor(raw), capped: capped.has(r.accountId) });
  }
  let paid = allocs.reduce((a, x) => a + x.floor, 0);
  let leftover = distributable - paid;
  // sub-1 accounts (floor 0, raw>0) closest to 1 first
  const subMin = allocs.filter((a) => a.floor < 1 && a.raw > 0).sort((a, b) => b.raw - a.raw);
  for (const a of subMin) { if (leftover < 1) break; a.floor = 1; leftover -= 1; paid += 1; }

  // Distribute any STILL-remaining leftover so the FULL pool goes out each week:
  // +1 POW to the largest fractional remainders among uncapped accounts (Hamilton's
  // method), skipping capped ones (already at the 10% ceiling). Only ≤1 extra per
  // account (leftover < account count), so no uncapped account can cross the cap.
  // carryover is then only the rare all-capped / empty-dimension case.
  if (leftover >= 1) {
    const byFrac = allocs
      .filter((a) => a.floor >= 1 && !a.capped)
      .sort((a, b) => b.raw - b.floor - (a.raw - a.floor));
    for (const a of byFrac) { if (leftover < 1) break; a.floor += 1; leftover -= 1; paid += 1; }
  }

  const claims: FrozenClaim[] = allocs
    .filter((a) => a.floor >= 1)
    .map((a) => ({
      accountId: a.row.accountId,
      allocationAtoms: a.floor,
      toAddress: a.toAddress,
      economicScore: a.row.economicScore,
      creationScore: a.row.creationScore,
      engagementScore: a.row.engagementScore,
      contributionScore: a.row.contributionScore,
      capped: a.capped,
      activity: a.row.activity,
    }))
    .sort((x, y) => y.allocationAtoms - x.allocationAtoms || y.contributionScore - x.contributionScore);

  return {
    isoWeek: bounds.isoWeek,
    poolAtoms: pool,
    carryInAtoms,
    distributableAtoms: distributable,
    carryoverAtoms: leftover,
    totals,
    claims,
    config: cfg,
  };
}

function priorWeekKey(b: WeekBounds): string {
  return weekBoundsFor(new Date(b.startUtc.getTime() - 1)).isoWeek;
}

/** Compute the week WITHOUT writing (uses the live config + prior-week carryover). */
export async function previewWeek(bounds: WeekBounds): Promise<WeekComputation> {
  const cfg = await loadConfig();
  const { data: prior } = await adminDb().from("pow_reward_epochs").select("carryover_atoms").eq("iso_week", priorWeekKey(bounds)).maybeSingle();
  return computeWeek(bounds, prior?.carryover_atoms ?? 0, cfg);
}

/** Freeze the week into the DB (idempotent). */
export async function freezeWeek(bounds: WeekBounds, opts: { force?: boolean } = {}): Promise<FreezeResult> {
  const db = adminDb();
  const now = new Date().toISOString();

  const { data: existing } = await db.from("pow_reward_epochs").select("*").eq("iso_week", bounds.isoWeek).maybeSingle();
  if (existing && !opts.force && existing.status !== "open") {
    const { data: claims } = await db.from("pow_reward_claims")
      .select("account_id, allocation_atoms, to_address, economic_score, creation_score, engagement_score, contribution_score, capped, activity")
      .eq("iso_week", bounds.isoWeek);
    return {
      isoWeek: bounds.isoWeek,
      alreadyFrozen: true,
      poolAtoms: existing.pool_atoms,
      carryInAtoms: 0,
      distributableAtoms: existing.pool_atoms + (existing.carryover_atoms ?? 0),
      carryoverAtoms: existing.carryover_atoms,
      totals: { economic: 0, creation: 0, engagement: 0, contribution: existing.total_contribution ?? 0 },
      claims: (claims ?? []).map((c) => ({
        accountId: c.account_id, allocationAtoms: c.allocation_atoms, toAddress: c.to_address,
        economicScore: c.economic_score ?? 0, creationScore: c.creation_score ?? 0, engagementScore: c.engagement_score ?? 0,
        contributionScore: c.contribution_score ?? 0, capped: c.capped ?? false, activity: (c.activity ?? {}) as Activity,
      })),
      config: (existing.config ?? {}) as RewardConfig,
    };
  }

  const cfg = await loadConfig();
  const { data: prior } = await db.from("pow_reward_epochs").select("carryover_atoms").eq("iso_week", priorWeekKey(bounds)).maybeSingle();
  const comp = await computeWeek(bounds, prior?.carryover_atoms ?? 0, cfg);

  const { error: eErr } = await db.from("pow_reward_epochs").upsert({
    iso_week: bounds.isoWeek,
    week_start: bounds.startUtc.toISOString(),
    week_end: bounds.endUtc.toISOString(),
    pool_atoms: comp.poolAtoms,
    carryover_atoms: comp.carryoverAtoms,
    total_fee_sats: comp.claims.reduce((a, c) => a + Math.round((c.activity.platformXec ?? 0) * 100), 0),
    total_economic: comp.totals.economic,
    total_creation: comp.totals.creation,
    total_engagement: comp.totals.engagement,
    total_contribution: comp.totals.contribution,
    config: comp.config,
    status: "tallied",
    computed_at: now,
    updated_at: now,
  }, { onConflict: "iso_week" });
  if (eErr) throw new Error(`freezeWeek epoch: ${eErr.message}`);

  // A re-tally (force, or a still-'open' epoch) can DROP accounts (e.g. a newly
  // excluded one) or change amounts — clear stale PENDING claims first so a
  // removed account can't keep an orphan claim. Only ever deletes 'pending' rows;
  // 'sent'/'sending' are never touched (force is a pre-payout correction).
  await db.from("pow_reward_claims").delete().eq("iso_week", bounds.isoWeek).eq("status", "pending");

  if (comp.claims.length) {
    const rows = comp.claims.map((c) => ({
      iso_week: bounds.isoWeek,
      account_id: c.accountId,
      fee_sats: Math.round((c.activity.platformXec ?? 0) * 100),
      allocation_atoms: c.allocationAtoms,
      to_address: c.toAddress,
      economic_score: c.economicScore,
      creation_score: c.creationScore,
      engagement_score: c.engagementScore,
      loyalty_mult: 1.0,
      contribution_score: c.contributionScore,
      capped: c.capped,
      activity: c.activity,
      status: "pending",
      updated_at: now,
    }));
    const { error: cErr } = await db.from("pow_reward_claims").upsert(rows, { onConflict: "iso_week,account_id" });
    if (cErr) throw new Error(`freezeWeek claims: ${cErr.message}`);
  }

  return { ...comp, alreadyFrozen: false };
}
