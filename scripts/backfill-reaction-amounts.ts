// =============================================================================
//  backfill-reaction-amounts.ts
//  Correct feed_events.amount_sats for likes/reposts (actions 5 and 4) recorded
//  while matchFeedTx stored the FLOOR requirement instead of the amount actually
//  paid. Under the old code every like read as 100 XEC, so a tip above the floor
//  (e.g. a 10,000 XEC like) was both under-reported on the rail AND mis-shown as
//  a plain "like". The money moved correctly on chain — only the recorded
//  metadata was wrong — so this re-derives each row from its own tx.
//
//  For each reaction it re-fetches the tx from Chronik and re-runs the SAME
//  matcher the live path now uses (verifyFeedTxid), then updates amount_sats when
//  it differs. Rows whose tx no longer verifies (deleted target, pruned tx) are
//  left untouched and reported.
//
//  Dry-run by default (prints what it WOULD change). Add --apply to write.
//
//    node --env-file=.env.local --import tsx scripts/backfill-reaction-amounts.ts
//    node --env-file=.env.local --import tsx scripts/backfill-reaction-amounts.ts --apply
//    ...optional: --limit 50
//
//  Needs in env: NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL),
//  SUPABASE_SERVICE_ROLE_KEY, PLATFORM_XEC_ADDRESS.
// =============================================================================

import { createClient } from "@supabase/supabase-js";
import { verifyFeedTxid } from "../lib/verifyFeedPost";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const APPLY = process.argv.includes("--apply");
const LIMIT = Number(arg("limit")) || Infinity;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const platformAddress = process.env.PLATFORM_XEC_ADDRESS?.trim();
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
if (!platformAddress) {
  console.error("Set PLATFORM_XEC_ADDRESS (the matcher checks the platform leg).");
  process.exit(1);
}

const supabase = createClient(url, key);
const xec = (sats: number) => (sats / 100).toLocaleString();

async function main() {
  // Only reactions carried the bug — posts/quotes/replies always paid an exact
  // length-priced amount, so their recorded floor already equalled the actual.
  const { data: rows, error } = await supabase
    .from("feed_events")
    .select("txid, action, target_txid, payout_address, amount_sats")
    .in("action", [4, 5])
    .order("created_at", { ascending: false });
  if (error) {
    console.error("query failed:", error.message);
    process.exit(1);
  }

  const events = (rows ?? []).slice(0, LIMIT === Infinity ? undefined : LIMIT);
  console.log(`${APPLY ? "APPLY" : "DRY-RUN"} · ${events.length} reaction(s) to check\n`);

  let corrected = 0;
  let unchanged = 0;
  let unverified = 0;

  for (const e of events) {
    const expected = {
      action: e.action,
      parentTxid: e.target_txid,
      contentHash: null,
      platformAddress,
      payoutAddress: e.payout_address,
      costXec: 100, // floor — the matcher records the ACTUAL leg, floor or above
    };
    const match = await verifyFeedTxid(e.txid, expected);
    if (!match) {
      unverified += 1;
      console.log(`  ?  ${e.txid.slice(0, 10)} — tx no longer verifies, left as-is`);
      continue;
    }
    const actual = match.sats;
    const stored = e.amount_sats ?? 0;
    if (actual === stored) {
      unchanged += 1;
      continue;
    }
    corrected += 1;
    console.log(`  ✎  ${e.txid.slice(0, 10)} — ${xec(stored)} → ${xec(actual)} XEC`);
    if (APPLY) {
      const { error: upErr } = await supabase
        .from("feed_events")
        .update({ amount_sats: actual })
        .eq("txid", e.txid);
      if (upErr) console.log(`     ! update failed: ${upErr.message}`);
    }
  }

  console.log(
    `\n${APPLY ? "updated" : "would update"} ${corrected} · unchanged ${unchanged} · unverified ${unverified}`,
  );
  if (!APPLY && corrected > 0) console.log("re-run with --apply to write these.");
}

main().then(() => process.exit(0));
