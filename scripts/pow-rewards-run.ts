// =============================================================================
//  scripts/pow-rewards-run.ts
//  Run a weekly POW reward payout in three escalating modes:
//
//    preview (default) — compute + print the allocation. NO DB writes, NO send.
//        npx tsx scripts/pow-rewards-run.ts --pool=1000
//
//    --commit          — freeze the tally into pow_reward_epochs/claims (pending).
//        npx tsx scripts/pow-rewards-run.ts --pool=1000 --commit
//
//    --broadcast       — freeze (if needed) then SEND POW to recipients. Guarded
//                        by CONFIRM=SEND so it can't fire by accident.
//        CONFIRM=SEND npx tsx scripts/pow-rewards-run.ts --pool=1000 --broadcast
//
//  Week: defaults to the LAST COMPLETE ISO week; override with --week=YYYY-Www.
//  Needs env: PLATFORM_XEC_ADDRESS, MINT_PAYMENT_ADDRESS, Supabase service key,
//  and (for --broadcast) POW_REWARD_WALLET_MNEMONIC. Reads .env.local.
//  PREREQ: apply sql/pow_rewards.sql in Supabase before --commit/--broadcast.
// =============================================================================

import "./_loadEnvLocal";

import { lastCompleteWeek, weekBoundsForKey } from "@/lib/powRewards/isoWeek";
import { tallyWeekRevenue } from "@/lib/powRewards/tallyWeek";
import { allocate } from "@/lib/powRewards/allocate";
import { freezeWeek } from "@/lib/powRewards/freezeWeek";
import { payWeek } from "@/lib/powRewards/payWeek";

const has = (f: string) => process.argv.includes(`--${f}`);
function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}
const xec = (sats: number) => (sats / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
const short = (id: string) => `${id.slice(0, 8)}…`;

function printClaims(claims: { accountId: string; feeSats: number; allocationAtoms: number; toAddress: string }[]) {
  if (!claims.length) {
    console.log("(no payable allocations — everything rolls forward)");
    return;
  }
  console.log("account        fee (XEC)      POW      primary address");
  console.log("─".repeat(78));
  for (const c of claims) {
    console.log(
      `${short(c.accountId).padEnd(12)}  ${xec(c.feeSats).padStart(12)}  ${String(c.allocationAtoms).padStart(8)}   ${c.toAddress}`,
    );
  }
}

async function main() {
  const weekArg = arg("week");
  const bounds = weekArg ? weekBoundsForKey(weekArg) : lastCompleteWeek();
  const pool = Number(arg("pool") ?? 1000);
  const commit = has("commit");
  const broadcast = has("broadcast");

  console.log(`\nPOW weekly rewards — ${broadcast ? "BROADCAST" : commit ? "COMMIT (freeze)" : "PREVIEW"}`);
  console.log(`Week ${bounds.isoWeek}: ${bounds.startUtc.toISOString()} → ${bounds.endUtc.toISOString()}`);
  console.log(`Base pool ${pool.toLocaleString()} POW\n`);

  // ---- PREVIEW: no writes ----
  if (!commit && !broadcast) {
    const tally = await tallyWeekRevenue(bounds.startUtc, bounds.endUtc);
    const alloc = await allocate(tally, pool, 0);
    console.log(`Eligible accounts: ${tally.perAccount.size}   Total fee weight: ${xec(tally.totalFeeSats)} XEC\n`);
    printClaims(alloc.claims);
    console.log("\n" + "─".repeat(78));
    console.log(`Would pay ${alloc.paidAtoms} POW to ${alloc.claims.length} accounts; ${alloc.carryoverAtoms} POW rolls forward.`);
    console.log(`(preview — nothing written. Note: real runs also add prior-week carryover.)`);
    console.log(`\nNext: --commit to freeze, then CONFIRM=SEND … --broadcast to pay.\n`);
    return;
  }

  // ---- COMMIT / BROADCAST guard ----
  if (broadcast && process.env.CONFIRM !== "SEND") {
    console.log("Refusing to broadcast without CONFIRM=SEND. Re-run:");
    console.log(`  CONFIRM=SEND npx tsx scripts/pow-rewards-run.ts${weekArg ? ` --week=${weekArg}` : ""} --pool=${pool} --broadcast\n`);
    process.exit(1);
  }

  // Freeze (idempotent — safe to run again).
  const frozen = await freezeWeek(bounds, pool);
  console.log(
    frozen.alreadyFrozen
      ? `Epoch ${frozen.isoWeek} already frozen — using existing claims.`
      : `Froze ${frozen.isoWeek}: ${frozen.claims.length} claims written (pending).`,
  );
  console.log(`Carry-in ${frozen.carryInAtoms} POW → carry-forward ${frozen.carryoverAtoms} POW. Total fee weight ${xec(frozen.totalFeeSats)} XEC.\n`);
  printClaims(frozen.claims);

  if (!broadcast) {
    console.log("\n" + "─".repeat(78));
    console.log(`Frozen (pending). To pay: CONFIRM=SEND npx tsx scripts/pow-rewards-run.ts${weekArg ? ` --week=${weekArg}` : ""} --pool=${pool} --broadcast\n`);
    return;
  }

  // ---- BROADCAST: send ----
  console.log("\nBroadcasting POW sends from the reward wallet…\n");
  const res = await payWeek(frozen.isoWeek, { broadcast: true });
  for (const b of res.batches) console.log(`  sent ${b.atoms} POW to ${b.recipients} recipient(s) — ${b.txid}`);
  console.log("\n" + "─".repeat(78));
  console.log(`Paid ${res.paidAtoms} POW to ${res.sentCount}/${res.pendingCount} claims across ${res.batches.length} tx(s).`);
  console.log();
}

main().catch((e) => {
  console.error("\nrun failed:", e?.message || e, "\n");
  process.exit(1);
});
