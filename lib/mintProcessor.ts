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
import { mintCapSoldOut, recordMintAgainstCap } from "./mintCap";
import { handleReservedByGrant } from "./grantReservation";
import { resolveOfficialAccount } from "./officialAccount";
import { contentHashHex } from "./feedProtocol";
import { CHRONIK_URLS } from "./ecash/chronikEndpoints";

const OFFICIAL_HANDLE = "proofofwriting"; // byline for handle-mint feed cards

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

    // defensive re-check: nobody minted/reserved/granted this skeleton meanwhile
    const [{ data: taken }, { data: reserved }, grantReserved] = await Promise.all([
      supabase.from("handles").select("token_id").eq("handle_skeleton", sk).limit(1).maybeSingle(),
      supabase.from("reserved_handles").select("handle_skeleton").eq("handle_skeleton", sk).limit(1).maybeSingle(),
      handleReservedByGrant(supabase, sk),
    ]);
    if (taken || reserved || grantReserved) {
      const refundTxid = await refund(await synced(wallet), m.payer_address, Number(m.expected_sats));
      await supabase.from("pending_mints").update({ status: "refunded", refund_txid: refundTxid, error: "unavailable at mint time" }).eq("id", mintId);
      return { status: "refunded", error: "name was no longer available" };
    }

    // 10K hard cap: once the collection is live and sold out, don't mint — refund
    // the payer. No-op pre-launch. Checked under the global mint_lock, so the
    // count can't be raced past the cap.
    if (await mintCapSoldOut()) {
      const refundTxid = await refund(await synced(wallet), m.payer_address, Number(m.expected_sats));
      await supabase.from("pending_mints").update({ status: "refunded", refund_txid: refundTxid, error: "collection sold out" }).eq("id", mintId);
      return { status: "refunded", error: "The collection is sold out." };
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

    // count this mint against the 10K cap (no-op pre-launch). Success-only, under
    // the lock, so a failed mint never consumes a slot.
    await recordMintAgainstCap();

    // best-effort image (deterministic, so safe to backfill if this fails)
    let imageUrl: string | null = null;
    try { imageUrl = await hostAsciiCard(res.handle, res.childTokenId); } catch { /* backfill later */ }

    await supabase.from("pending_mints")
      .update({ status: "minted", child_token_id: res.childTokenId, image_url: imageUrl })
      .eq("id", mintId);

    // Announce the mint as a native feed card. The row's txid IS the token id
    // (child genesis txid), so every reply/quote/like/repost — all of which
    // resolve their target by feed_posts.txid — works on it natively, and it
    // ranks through the normal engagement pipeline. Authored by the mint wallet's
    // account (the @proofofwriting holder); reactions/tips pay that same wallet.
    // Best-effort: a feed hiccup must never fail (or refund) a completed mint.
    try {
      const official = await resolveOfficialAccount(supabase);
      if (official) {
        const priceXec = Number(m.expected_sats) / 100;
        const content = `@${res.handle} minted · ${priceXec.toLocaleString("en-US")} XEC`;
        await supabase.from("feed_posts").insert({
          txid: res.childTokenId,
          action: 1,                                   // POST → surfaces in the main timeline
          content,
          content_hash: contentHashHex(content),
          card_kind: "handle_mint",
          image_url: imageUrl,
          card_meta: {
            handle: res.handle,
            tier,
            priceXec,
            minterAddress: m.payer_address,
          },
          author_account_id: official.accountId,
          author_identity: `@${OFFICIAL_HANDLE}`,
          payer_address: official.address,
          payout_address: official.address,            // tips on mint cards go to the platform
          amount_sats: 0,
          finalized_at: new Date().toISOString(),
        });
      } else {
        console.warn("[mintProcessor] official account not found — skipped mint feed card (run scripts/ensure-official-account.ts)");
      }
    } catch (e) {
      console.warn("[mintProcessor] mint feed-card insert failed (non-fatal):", e instanceof Error ? e.message : e);
    }

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
