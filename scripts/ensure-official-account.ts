// =============================================================================
//  ensure-official-account.ts
//  One-time (idempotent): create/ensure the official @proofofwriting account that
//  authors handle-mint feed cards, anchored to the platform payout address.
//
//    NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//    MINT_PAYMENT_ADDRESS=ecash:q... GROUP_TOKEN_ID=... \
//    npx tsx scripts/ensure-official-account.ts
//
//  Anchors to the mint wallet's address (MINT_PAYMENT_ADDRESS) — the wallet that
//  holds @proofofwriting and receives mint-card tips. Safe to re-run: if that
//  address is already linked to an account it reuses it and just (re)sets
//  display_handle. Prints the account id.
//
//  ALSO backfills the on-chain handle into the DB. @proofofwriting is minted
//  DIRECTLY to the mint wallet (not through the site's mint pipeline), so the
//  `handles` registry row — which /@proofofwriting resolution requires — is never
//  created and the profile 404s. This script closes that gap: it finds the
//  @proofofwriting NFT the mint wallet holds (via Chronik), inserts the missing
//  `handles` row, and binds the token to the official account. Idempotent.
//
//  Alternative to running this: just log in to the site with the mint wallet
//  AFTER minting @proofofwriting to it — the normal login flow creates the account
//  and auto-binds display_handle='proofofwriting'. This script is the headless path.
// =============================================================================

import { createClient } from "@supabase/supabase-js";
import { ChronikClient } from "chronik-client";
import { officialAddress, addressForms } from "../lib/officialAccount";
import { skeleton } from "../lib/handleSkeleton";
import { priceForHandle } from "../lib/handlePricing";
import { CHRONIK_URLS } from "../lib/ecash/chronikEndpoints";

const HANDLE = "proofofwriting";

/** Find the token id of the NFT1-child named `handle` currently held by `addr`.
 *  @proofofwriting is minted directly to the mint wallet, so we discover it
 *  on-chain rather than reading a DB row that may not exist yet. */
async function findHeldHandleToken(addr: string, handle: string): Promise<string | null> {
  try {
    const chronik = new ChronikClient(CHRONIK_URLS);
    const res: any = await chronik.address(addr).utxos();
    const tokenIds = [...new Set((res?.utxos ?? []).filter((u: any) => u.token).map((u: any) => u.token.tokenId))] as string[];
    for (const tid of tokenIds) {
      const info: any = await chronik.token(tid);
      if (info?.tokenType?.type === "SLP_TOKEN_TYPE_NFT1_CHILD" && info?.genesisInfo?.tokenName === handle) {
        return tid;
      }
    }
    return null;
  } catch (e) {
    console.warn("Chronik lookup failed — skipping handle backfill:", e instanceof Error ? e.message : e);
    return null;
  }
}

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
      .insert({ display_handle: HANDLE, updated_at: now })
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

  // 3) backfill the handle registry row + bind it to the account. Without the
  //    `handles` row, resolveHandle('proofofwriting') returns null and the
  //    profile 404s (this is the whole reason the page was broken).
  const tokenId = await findHeldHandleToken(addr, HANDLE);
  if (!tokenId) {
    console.warn(`\n⚠ Could not find an NFT1-child named "${HANDLE}" held by ${addr}. ` +
      `Mint @${HANDLE} to the mint wallet first, then re-run. Account is set up, but /@${HANDLE} will 404 until the handle is minted + backfilled.`);
  } else {
    const sk = skeleton(HANDLE);
    const { tier } = priceForHandle(HANDLE);

    const { data: existing } = await supabase
      .from("handles").select("token_id").eq("handle_skeleton", sk).maybeSingle();

    // best-effort card image (deterministic; seed = child genesis txid = tokenId).
    // Isolated in a dynamic import so a rasterizer load failure can't abort setup.
    let imageUrl: string | null = null;
    try {
      const { hostAsciiCard } = await import("../lib/nft-art/hostAsciiCard");
      imageUrl = await hostAsciiCard(HANDLE, tokenId);
    } catch (e) {
      console.warn("Card image host failed (non-fatal, on-demand route still renders it):", e instanceof Error ? e.message : e);
    }

    if (!existing) {
      const { error: hErr } = await supabase.from("handles").insert({
        token_id: tokenId,
        handle: HANDLE,
        handle_skeleton: sk,
        origin: "mint",
        tier,
        minted_for_account_id: accountId,
        mint_txid: tokenId,
        image_url: imageUrl,
      });
      if (hErr) { console.error("Failed to insert handles row:", hErr.message); process.exit(1); }
      console.log(`Inserted handles row for @${HANDLE} (${tier}).`);
    } else if (imageUrl) {
      // Row already present (e.g. a prior run) — refresh only the image if we got one.
      await supabase.from("handles").update({ image_url: imageUrl }).eq("token_id", tokenId);
      console.log(`handles row for @${HANDLE} already present; refreshed image.`);
    } else {
      console.log(`handles row for @${HANDLE} already present.`);
    }

    // Bind the token to the official account so resolveHandle takes its fast path
    // and the byline shows @proofofwriting on the account's posts/mint cards.
    await supabase.from("accounts")
      .update({ active_handle_token_id: tokenId, display_handle: HANDLE, display_handle_checked_at: now })
      .eq("id", accountId);
    console.log(`Bound token ${tokenId.slice(0, 12)}… to the official account.`);
  }

  console.log("\n--- OFFICIAL ACCOUNT -----------------------------------------");
  console.log("account id     :", accountId);
  console.log("display_handle :", HANDLE, `(byline "@${HANDLE}")`);
  console.log("address        :", addr, "(mint wallet — holds @proofofwriting; mint-card tips land here)");
  console.log("--------------------------------------------------------------");
  console.log("mintProcessor resolves this account by MINT_PAYMENT_ADDRESS — no env id needed.");
}

main().catch((e) => { console.error(e); process.exit(1); });
