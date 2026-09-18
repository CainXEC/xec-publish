// =============================================================================
//  scripts/pow-rewards-run.ts
//  Run a weekly POW reward payout in three escalating modes:
//
//    preview (default) — compute + print the Contribution-Score allocation.
//                        NO DB writes, NO send.
//        npx tsx scripts/pow-rewards-run.ts
//
//    --commit          — freeze the tally into pow_reward_epochs/claims (pending).
//        npx tsx scripts/pow-rewards-run.ts --commit
//
//    --broadcast       — freeze (if needed) then SEND POW. Guarded by CONFIRM=SEND.
//        CONFIRM=SEND npx tsx scripts/pow-rewards-run.ts --broadcast
//
//  Week: defaults to the LAST COMPLETE ISO week; override with --week=YYYY-Www.
//  Pool + all scoring params come from pow_reward_config (edit that row, no deploy).
//  Needs env: PLATFORM_XEC_ADDRESS, MINT_PAYMENT_ADDRESS, Supabase service key,
//  and (for --broadcast) POW_REWARD_WALLET_MNEMONIC. Reads .env.local.
//  PREREQ: apply sql/pow_rewards.sql AND sql/pow_rewards_scoring.sql in Supabase.
// =============================================================================

import "./_loadEnvLocal";

import { lastCompleteWeek, weekBoundsForKey } from "@/lib/powRewards/isoWeek";
import { previewWeek, freezeWeek, type FrozenClaim } from "@/lib/powRewards/freezeWeek";
import { payWeek } from "@/lib/powRewards/payWeek";

const has = (f: string) => process.argv.includes(`--${f}`);
function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}
const short = (id: string) => `${id.slice(0, 8)}…`;
const n2 = (x: number) => x.toFixed(1).padStart(6);

function printClaims(claims: FrozenClaim[]) {
  if (!claims.length) { console.log("(no payable allocations — everything rolls forward)"); return; }
  console.log("account         POW    econ    crea     eng   contrib  cap  activity");
  console.log("─".repeat(92));
  for (const c of claims) {
    const a = c.activity;
    const act = `xec ${Math.round(a.platformXec)} · art ${a.articles} · post ${a.feedPosts} · rep ${a.replies} · qt ${a.quotes} · unl ${a.unlocksMade}/${a.unlocksReceived} · uniq ${a.uniqueCounterparties}`;
    console.log(`${short(c.accountId).padEnd(11)} ${String(c.allocationAtoms).padStart(5)}  ${n2(c.economicScore)}  ${n2(c.creationScore)}  ${n2(c.engagementScore)}  ${n2(c.contributionScore)}  ${c.capped ? "▲" : " "}   ${act}`);
  }
}

async function main() {
  const weekArg = arg("week");
  const bounds = weekArg ? weekBoundsForKey(weekArg) : lastCompleteWeek();
  const commit = has("commit");
  const broadcast = has("broadcast");

  console.log(`\nPOW weekly rewards — ${broadcast ? "BROADCAST" : commit ? "COMMIT (freeze)" : "PREVIEW"}`);
  console.log(`Week ${bounds.isoWeek}: ${bounds.startUtc.toISOString()} → ${bounds.endUtc.toISOString()}\n`);

  // ---- PREVIEW ----
  if (!commit && !broadcast) {
    const comp = await previewWeek(bounds);
    console.log(`Pool ${comp.poolAtoms} POW + carry-in ${comp.carryInAtoms} = ${comp.distributableAtoms} distributable`);
    console.log(`Weights → econ ${comp.config.weights.economic} · creation ${comp.config.weights.creation} · engagement ${comp.config.weights.engagement}   cap ${comp.config.maxUserShare * 100}%\n`);
    printClaims(comp.claims);
    console.log("\n" + "─".repeat(92));
    const paid = comp.claims.reduce((a, c) => a + c.allocationAtoms, 0);
    console.log(`Would pay ${paid} POW to ${comp.claims.length} accounts; ${comp.carryoverAtoms} rolls forward. (preview — nothing written)`);
    console.log(`Next: --commit to freeze, then CONFIRM=SEND … --broadcast to pay.\n`);
    return;
  }

  if (broadcast && process.env.CONFIRM !== "SEND") {
    console.log("Refusing to broadcast without CONFIRM=SEND. Re-run:");
    console.log(`  CONFIRM=SEND npx tsx scripts/pow-rewards-run.ts${weekArg ? ` --week=${weekArg}` : ""} --broadcast\n`);
    process.exit(1);
  }

  const frozen = await freezeWeek(bounds, { force: has("force") });
  console.log(
    frozen.alreadyFrozen
      ? `Epoch ${frozen.isoWeek} already frozen — using existing ${frozen.claims.length} claims.`
      : `Froze ${frozen.isoWeek}: ${frozen.claims.length} claims (pending). Carry-in ${frozen.carryInAtoms} → carry-forward ${frozen.carryoverAtoms}.`,
  );
  console.log();
  printClaims(frozen.claims);

  if (!broadcast) {
    console.log("\n" + "─".repeat(92));
    console.log(`Frozen (pending). To pay: CONFIRM=SEND npx tsx scripts/pow-rewards-run.ts${weekArg ? ` --week=${weekArg}` : ""} --broadcast\n`);
    return;
  }

  console.log("\nBroadcasting POW sends from the reward wallet…\n");
  const res = await payWeek(frozen.isoWeek, { broadcast: true });
  for (const b of res.batches) console.log(`  sent ${b.atoms} POW to ${b.recipients} recipient(s) — ${b.txid}`);
  console.log("\n" + "─".repeat(92));
  console.log(`Paid ${res.paidAtoms} POW to ${res.sentCount}/${res.pendingCount} claims across ${res.batches.length} tx(s).\n`);
}

main().catch((e) => { console.error("\nrun failed:", e?.message || e, "\n"); process.exit(1); });
