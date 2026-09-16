// =============================================================================
//  lib/powRewards/allocate.ts
//  Turn a week's per-account fee weights into whole-POW allocations.
//  See docs/pow-token-migration-plan.md §5.
//
//    allocation = floor( (pool + carryover) × feeSats / totalFeeSats )
//
//  POW is 0-decimal, so every award is floored to a whole token. DECIDED rules:
//    • minimum payout = 1 POW — a floored share < 1 is dropped and rolls forward.
//    • the flooring remainder (pool minus the sum of floors) also rolls forward.
//  Both roll-forwards are returned as `carryoverAtoms` for next week's epoch.
//
//  READ-ONLY: pure computation + a primary-address lookup. No writes, no sends.
// =============================================================================

import { adminDb } from "@/lib/db";
import type { WeekTally } from "./tallyWeek";

export interface RewardClaim {
  accountId: string; // effective (cluster) account
  feeSats: number; // the weight
  allocationAtoms: number; // whole POW, >= 1
  toAddress: string; // account's primary address at tally time
}

export interface Allocation {
  claims: RewardClaim[];
  distributableAtoms: number; // pool + carryover
  paidAtoms: number; // sum of claim allocations
  carryoverAtoms: number; // remainder + sub-1 shares -> next week
  droppedSubMin: number; // accounts that scored but floored to 0 POW
  missingAddress: number; // effective accounts with no primary address (skipped)
}

/** Resolve each effective account's primary (payout) address. */
async function primaryAddresses(accountIds: string[]): Promise<Map<string, string>> {
  const db = adminDb();
  const map = new Map<string, string>();
  for (let i = 0; i < accountIds.length; i += 300) {
    const chunk = accountIds.slice(i, i + 300);
    const { data, error } = await db
      .from("account_addresses")
      .select("account_id, address")
      .eq("is_primary", true)
      .in("account_id", chunk);
    if (error) throw new Error(`primaryAddresses: ${error.message}`);
    for (const r of data ?? []) {
      if (!map.has(r.account_id as string)) map.set(r.account_id as string, r.address as string);
    }
  }
  return map;
}

/**
 * Allocate `poolAtoms` (+ any `carryInAtoms` rolled from prior weeks) across the
 * tallied accounts, pro-rata by fee weight. Returns the claims to pay plus the
 * carryover to seed next week.
 */
export async function allocate(
  tally: WeekTally,
  poolAtoms: number,
  carryInAtoms = 0,
): Promise<Allocation> {
  const distributableAtoms = poolAtoms + carryInAtoms;
  const { perAccount, totalFeeSats } = tally;

  // No eligible activity → nothing paid, whole pool rolls forward.
  if (totalFeeSats <= 0 || perAccount.size === 0) {
    return {
      claims: [],
      distributableAtoms,
      paidAtoms: 0,
      carryoverAtoms: distributableAtoms,
      droppedSubMin: 0,
      missingAddress: 0,
    };
  }

  const addrMap = await primaryAddresses(Array.from(perAccount.keys()));

  const claims: RewardClaim[] = [];
  let paidAtoms = 0;
  let droppedSubMin = 0;
  let missingAddress = 0;

  for (const [accountId, feeSats] of perAccount) {
    const raw = (distributableAtoms * feeSats) / totalFeeSats;
    const atoms = Math.floor(raw);
    if (atoms < 1) {
      droppedSubMin += 1; // rolls forward
      continue;
    }
    const toAddress = addrMap.get(accountId);
    if (!toAddress) {
      missingAddress += 1; // can't pay without a primary address; rolls forward
      continue;
    }
    claims.push({ accountId, feeSats, allocationAtoms: atoms, toAddress });
    paidAtoms += atoms;
  }

  // Largest weight first — nicer to read, and the natural order to send in.
  claims.sort((a, b) => b.allocationAtoms - a.allocationAtoms || b.feeSats - a.feeSats);

  return {
    claims,
    distributableAtoms,
    paidAtoms,
    carryoverAtoms: distributableAtoms - paidAtoms,
    droppedSubMin,
    missingAddress,
  };
}
