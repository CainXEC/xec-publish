// =============================================================================
//  scripts/pow-rewards-dry-run.ts
//  Print the weekly POW reward table for a week — READ ONLY. No DB writes, no
//  token sends. Use it to eyeball who would earn what before wiring the payout.
//
//  Usage (from repo root):
//    npx tsx scripts/pow-rewards-dry-run.ts                 # last complete week, 1000 POW pool
//    npx tsx scripts/pow-rewards-dry-run.ts --week=2026-W37 --pool=1000 --carry=0
//
//  Needs env: PLATFORM_XEC_ADDRESS (and optionally POW_REWARD_EXCLUDED_ACCOUNTS,
//  NEXT_PUBLIC_SUPABASE_URL + the service key). Reads .env.local if present.
// =============================================================================

import { readFileSync } from "node:fs";

// Best-effort .env.local load so the script "just works" locally (read-only).
try {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
} catch {
  /* no .env.local — rely on the exported environment */
}

import { lastCompleteWeek, weekBoundsForKey } from "@/lib/powRewards/isoWeek";
import { tallyWeekRevenue } from "@/lib/powRewards/tallyWeek";
import { allocate } from "@/lib/powRewards/allocate";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

const xec = (sats: number) => (sats / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
const short = (id: string) => `${id.slice(0, 8)}…`;

async function main() {
  const weekArg = arg("week");
  const bounds = weekArg ? weekBoundsForKey(weekArg) : lastCompleteWeek();
  const pool = Number(arg("pool") ?? 1000);
  const carry = Number(arg("carry") ?? 0);

  console.log(`\nPOW weekly rewards — DRY RUN (nothing is written or sent)`);
  console.log(`Week ${bounds.isoWeek}: ${bounds.startUtc.toISOString()} → ${bounds.endUtc.toISOString()}`);
  console.log(`Pool ${pool.toLocaleString()} POW  +  carry-in ${carry.toLocaleString()} POW\n`);

  const tally = await tallyWeekRevenue(bounds.startUtc, bounds.endUtc);
  const alloc = await allocate(tally, pool, carry);

  console.log(
    `Revenue receipts (platform fees + mint payments) in window: ${tally.receiptCount} attributed` +
      (tally.skippedUnattributed ? `, ${tally.skippedUnattributed} from unlinked wallets (skipped)` : ""),
  );
  console.log(`Eligible accounts: ${tally.perAccount.size}   Total fee weight: ${xec(tally.totalFeeSats)} XEC\n`);

  if (alloc.claims.length === 0) {
    console.log("No payable allocations this week — entire distributable rolls forward.");
  } else {
    console.log("account        fee (XEC)      POW      primary address");
    console.log("─".repeat(78));
    for (const c of alloc.claims) {
      console.log(
        `${short(c.accountId).padEnd(12)}  ${xec(c.feeSats).padStart(12)}  ${String(c.allocationAtoms).padStart(8)}   ${c.toAddress}`,
      );
    }
  }

  console.log("\n" + "─".repeat(78));
  console.log(`Distributable : ${alloc.distributableAtoms.toLocaleString()} POW`);
  console.log(`Paid out      : ${alloc.paidAtoms.toLocaleString()} POW  (${alloc.claims.length} accounts)`);
  console.log(`Carry forward : ${alloc.carryoverAtoms.toLocaleString()} POW  (remainder + ${alloc.droppedSubMin} sub-1-POW shares)`);
  if (alloc.missingAddress) console.log(`⚠ ${alloc.missingAddress} account(s) had no primary address — skipped, rolled forward`);
  console.log();
}

main().catch((e) => {
  console.error("dry-run failed:", e?.message || e);
  process.exit(1);
});
