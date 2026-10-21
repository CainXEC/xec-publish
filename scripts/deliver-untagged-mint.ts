// =============================================================================
//  scripts/deliver-untagged-mint.ts
//  Deliver a handle mint whose payment landed WITHOUT the mintId tag — a buyer
//  who copied the address and sent by hand, so the poll + reconciler could never
//  match it. Routes through the app's own claimPaidOrRefund → processPaidMint
//  (lock-serialized, double-mint-safe, handles row + cap + card + feed post), so
//  nothing is hand-minted. Dry-run by default; only acts with BOTH --deliver AND
//  CONFIRM=DELIVER.
//
//    # dry run: verify the payment on chain and print the plan
//    npx tsx scripts/deliver-untagged-mint.ts --mint <pending_mints.id> --txid <payment txid> --payer ecash:q...
//
//    # for real:
//    CONFIRM=DELIVER npx tsx scripts/deliver-untagged-mint.ts --mint <id> --txid <txid> --payer ecash:q... --deliver
//
//  --payer is the buyer's address as YOU read it off the explorer (required when
//  the intent was made logged-out and so has no expected_payers): the script
//  only proceeds if the tx's payer is exactly that address. An intent stuck in
//  'expired' (a late poll flipped it) is put back to 'pending' first, so the
//  normal pending→paid claim applies. Reads .env.local (prod Supabase + mint wallet).
// =============================================================================

import "./_loadEnvLocal";

import { ChronikClient } from "chronik-client";
import { adminDb } from "@/lib/db";
import { CHRONIK_URLS } from "@/lib/ecash/chronikEndpoints";
import { matchXecMintTx } from "@/lib/mintPayments";
import { claimPaidOrRefund } from "@/lib/mintProcessor";
import { mintCapSoldOut } from "@/lib/mintCap";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function fail(msg: string): never {
  console.error("STOP:", msg);
  process.exit(1);
}

async function main() {
  const mintId = arg("mint") ?? fail("need --mint <pending_mints.id>");
  const txid = arg("txid") ?? fail("need --txid <payment txid>");
  const payerArg = arg("payer")?.trim().toLowerCase();
  const mintAddress = process.env.MINT_PAYMENT_ADDRESS ?? fail("MINT_PAYMENT_ADDRESS not set");
  const supabase = adminDb();

  const { data: m } = await supabase.from("pending_mints").select("*").eq("id", mintId).maybeSingle();
  if (!m) fail(`no pending_mints row ${mintId}`);
  if (m.status === "minted") { console.log(`Already minted → ${m.child_token_id}`); return; }
  if (!["pending", "expired"].includes(m.status)) fail(`row is '${m.status}', not pending/expired — the normal path owns it`);
  if ((m.pay_token ?? "xec") !== "xec") fail("this is a POW intent; this script is for XEC payments");

  const expectedPayers: string[] = m.expected_payers?.length
    ? m.expected_payers
    : payerArg
      ? [payerArg.startsWith("ecash:") ? payerArg : `ecash:${payerArg}`]
      : fail("intent has no expected_payers — pass --payer <the buyer's address from the explorer>");

  const tx = await new ChronikClient(CHRONIK_URLS).tx(txid);
  const match = matchXecMintTx(tx, mintAddress, mintId, Number(m.expected_sats), expectedPayers);
  if (!match) fail("tx does not pay this mint (wrong amount/payer, our own tx, or tagged for a different mint)");
  if (!match.isFinal) fail("payment is not Avalanche-final yet — try again in a moment");

  const [{ data: used }, { data: held }, { data: claim }] = await Promise.all([
    supabase.from("pending_mints").select("id, status").eq("payment_txid", txid).neq("id", mintId).limit(1).maybeSingle(),
    supabase.from("handles").select("token_id").eq("handle_skeleton", m.handle_skeleton).limit(1).maybeSingle(),
    supabase.from("pending_mints").select("id").eq("handle_skeleton", m.handle_skeleton).in("status", ["paid", "stuck"]).neq("id", mintId).limit(1).maybeSingle(),
  ]);
  if (used) fail(`payment already funded mint ${used.id} (${used.status})`);
  const soldOut = await mintCapSoldOut();

  const seen = Number(tx.timeFirstSeen ?? 0);
  console.log("--- DELIVERY PLAN ---------------------------------------------");
  console.log("mint id       :", mintId, `(status ${m.status})`);
  console.log("handle        :", "@" + m.handle);
  console.log("intent made   :", m.created_at, "· window ends", m.expires_at);
  console.log("payment       :", txid, `(${match.match})`);
  console.log("paid          :", (match.sats / 100).toLocaleString("en-US"), "XEC of", (Number(m.expected_sats) / 100).toLocaleString("en-US"));
  console.log("first seen    :", seen ? new Date(seen * 1000).toISOString() : "unknown");
  console.log("deliver to    :", match.payerAddress);
  console.log("name free?    :", held ? `NO — handles row ${held.token_id} (the app would REFUND)` : claim ? `NO — claimed by ${claim.id} (the app would REFUND)` : "yes");
  console.log("sold out?     :", soldOut ? "YES (the app would REFUND)" : "no");
  console.log("---------------------------------------------------------------");

  if (!(process.argv.includes("--deliver") && process.env.CONFIRM === "DELIVER")) {
    console.log("\nDRY RUN — nothing written or broadcast. Re-run with CONFIRM=DELIVER and --deliver.");
    return;
  }

  if (m.status === "expired") {
    const { error } = await supabase.from("pending_mints").update({ status: "pending" }).eq("id", mintId).eq("status", "expired");
    if (error) fail(`couldn't reopen expired row: ${error.message}`);
  }
  const res = await claimPaidOrRefund(mintId, match.payerAddress, txid);
  console.log("\nResult:", JSON.stringify(res));
  if (res.status === "processing") console.log("Row is 'paid' — the 5-min reconciler (Pass A) will finish it.");
}

main().catch((e) => { console.error(e); process.exit(1); });
