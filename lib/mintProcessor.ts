// =============================================================================
//  mintProcessor.ts
//  Finishes a PAID mint. Serialized by the global mint_lock so only one child
//  mint broadcasts at a time (group-UTXO race). Auto-refunds on failure.
// =============================================================================

import { createClient } from "@supabase/supabase-js";
import { skeleton } from "./handleSkeleton";
import { priceForHandle } from "./handlePricing";
import { loadMintWallet, mintHandleChild } from "./mintHandleChild";
import { hostAsciiCard } from "./nft-art/hostAsciiCard"; // best-effort image host (Gen 1 ASCII card, seed = mint txid)

const CHRONIK_URLS = ["https://chronik.e.cash", "https://chronik-native.fabien.cash"];
const supabase = createClient((process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL)!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const LOCK_HOLDER = () => `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

async function claimMintLock(holder: string): Promise<boolean> {
  // one atomic UPDATE ... WHERE (free or expired) RETURNING — no race, no SQL fn needed
  const now = new Date().toISOString();
  const until = new Date(Date.now() + 45_000).toISOString();
  const { data } = await supabase
    .from("mint_lock")
    .update({ locked_until: until, holder })
    .eq("id", 1)
    .or(`locked_until.is.null,locked_until.lt.${now}`)
    .select("id");
  return Array.isArray(data) && data.length === 1;
}
async function releaseMintLock(holder: string) {
  await supabase.from("mint_lock").update({ locked_until: null, holder: null }).eq("id", 1).eq("holder", holder);
}

async function refund(wallet: any, toAddress: string, sats: number): Promise<string | null> {
  try {
    const built: any = wallet.action({ outputs: [{ address: toAddress, sats: BigInt(sats) }] }).build();
    const resp: any = await built.broadcast();
    return Array.isArray(resp) ? resp[resp.length - 1] : (resp?.txid ?? resp ?? null);
  } catch {
    return null;
  }
}

/**
 * Process one paid mint. Idempotent-ish: only acts on rows still in 'paid'.
 * Returns a status the polling endpoint can relay to the browser.
 */
export async function processPaidMint(mintId: string): Promise<{ status: string; childTokenId?: string; error?: string }> {
  const { data: m } = await supabase.from("pending_mints").select("*").eq("id", mintId).maybeSingle();
  if (!m) return { status: "not_found" };
  if (m.status === "minted") return { status: "minted", childTokenId: m.child_token_id };
  if (m.status !== "paid") return { status: m.status };

  const holder = LOCK_HOLDER();
  if (!(await claimMintLock(holder))) return { status: "processing" }; // another mint in flight; poll again

  const wallet = loadMintWallet(CHRONIK_URLS, {
    mnemonic: process.env.MINT_WALLET_MNEMONIC,
    skHex: process.env.MINT_WALLET_SK,
  });

  try {
    const sk = skeleton(m.handle);

    // defensive re-check: nobody minted/reserved this skeleton meanwhile
    const [{ data: taken }, { data: reserved }] = await Promise.all([
      supabase.from("handles").select("token_id").eq("handle_skeleton", sk).maybeSingle(),
      supabase.from("reserved_handles").select("handle_skeleton").eq("handle_skeleton", sk).maybeSingle(),
    ]);
    if (taken || reserved) {
      const refundTxid = await refund(await synced(wallet), m.payer_address, Number(m.expected_sats));
      await supabase.from("pending_mints").update({ status: "refunded", refund_txid: refundTxid, error: "unavailable at mint time" }).eq("id", mintId);
      return { status: "refunded", error: "name was no longer available" };
    }

    // MINT (mintHandleChild syncs the wallet internally)
    const res = await mintHandleChild(wallet, {
      handle: m.handle,
      buyerAddress: m.payer_address,
      groupTokenId: process.env.GROUP_TOKEN_ID!,
    });

    // record the handle as the source of truth
    const { tier } = priceForHandle(m.handle);
    await supabase.from("handles").insert({
      token_id: res.childTokenId,
      handle: res.handle,
      handle_skeleton: sk,
      origin: "mint",
      tier,
      mint_txid: res.childTokenId,
    });

    // best-effort image (deterministic, so safe to backfill if this fails)
    let imageUrl: string | null = null;
    try { imageUrl = await hostAsciiCard(res.handle, res.childTokenId); } catch { /* backfill later */ }

    await supabase.from("pending_mints")
      .update({ status: "minted", child_token_id: res.childTokenId, image_url: imageUrl })
      .eq("id", mintId);

    return { status: "minted", childTokenId: res.childTokenId };
  } catch (e: any) {
    // AUTO-REFUND on any mint failure
    const refundTxid = await refund(await synced(wallet), m.payer_address, Number(m.expected_sats));
    await supabase.from("pending_mints")
      .update({ status: refundTxid ? "refunded" : "failed", refund_txid: refundTxid, error: String(e?.message ?? e) })
      .eq("id", mintId);
    return { status: refundTxid ? "refunded" : "failed", error: String(e?.message ?? e) };
  } finally {
    await releaseMintLock(holder);
  }
}

async function synced(wallet: any) { await wallet.sync(); return wallet; }
