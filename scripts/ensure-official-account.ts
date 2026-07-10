// =============================================================================
//  ensure-official-account.ts
//  One-time (idempotent): create/ensure the official @proofofwriting account that
//  authors handle-mint feed cards, anchored to the platform payout address.
//
//    NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//    MINT_PAYMENT_ADDRESS=ecash:q... npx tsx scripts/ensure-official-account.ts
//
//  Anchors to the mint wallet's address (MINT_PAYMENT_ADDRESS) — the wallet that
//  holds @proofofwriting and receives mint-card tips. Safe to re-run: if that
//  address is already linked to an account it reuses it and just (re)sets
//  display_handle. Prints the account id.
//
//  Alternative to running this: just log in to the site with the mint wallet
//  AFTER minting @proofofwriting to it — the normal login flow creates the account
//  and auto-binds display_handle='proofofwriting'. This script is the headless path.
// =============================================================================

import { createClient } from "@supabase/supabase-js";
import { officialAddress, addressForms } from "../lib/officialAccount";

const HANDLE = "proofofwriting";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const addr = officialAddress();
  if (!url || !key) { console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."); process.exit(1); }
  if (!addr) { console.error("Set MINT_PAYMENT_ADDRESS (the mint wallet address that holds @proofofwriting)."); process.exit(1); }

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const now = new Date().toISOString();

  // 1) already linked?
  const { data: link } = await supabase
    .from("account_addresses").select("account_id").in("address", addressForms(addr)).limit(1);
  let accountId = link?.[0]?.account_id as string | undefined;

  // 2) create the account if needed
  if (!accountId) {
    const { data: acct, error } = await supabase
      .from("accounts")
      .insert({ kind: "author", display_handle: HANDLE, updated_at: now })
      .select("id").single();
    if (error || !acct) { console.error("Failed to create account:", error?.message); process.exit(1); }
    accountId = acct.id as string;
    const { error: linkErr } = await supabase
      .from("account_addresses")
      .insert({ account_id: accountId, address: addr, is_primary: true, verified_at: now });
    if (linkErr) { console.error("Failed to link address:", linkErr.message); process.exit(1); }
    console.log("Created official account.");
  } else {
    // ensure the byline is set on the existing account
    await supabase.from("accounts").update({ display_handle: HANDLE, updated_at: now }).eq("id", accountId);
    console.log("Reused existing account linked to the platform address.");
  }

  console.log("\n--- OFFICIAL ACCOUNT -----------------------------------------");
  console.log("account id     :", accountId);
  console.log("display_handle :", HANDLE, `(byline "@${HANDLE}")`);
  console.log("address        :", addr, "(mint wallet — holds @proofofwriting; mint-card tips land here)");
  console.log("--------------------------------------------------------------");
  console.log("mintProcessor resolves this account by MINT_PAYMENT_ADDRESS — no env id needed.");
}

main().catch((e) => { console.error(e); process.exit(1); });
