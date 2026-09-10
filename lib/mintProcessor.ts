// =============================================================================
//  mintProcessor.ts
//  Finishes a PAID mint. Serialized by the global mint_lock so only one child
//  mint broadcasts at a time (group-UTXO race).
//
//  DELIVERY, NOT REFUND: a paid mint that hits a TRANSIENT failure (a Chronik
//  timeout, a wallet-sync hiccup, a broadcast that needed a retry) is retried —
//  the buyer paid, so we keep trying to deliver. The row stays 'paid' and the
//  reconciler (lib/mintReconcile) re-runs it. A refund happens ONLY when delivery
//  is genuinely impossible: the name is already held by SOMEONE ELSE, or the
//  collection is sold out.
//
//  DOUBLE-MINT SAFETY: retries never re-broadcast a mint that already landed.
//  Before re-minting we (a) adopt the existing handle if it's already been
//  delivered to this payer, and (b) space attempts by MIN_RETRY_INTERVAL_MS so an
//  in-flight broadcast has time to index — if it's still not on-chain after that,
//  the prior attempt provably didn't land and re-minting is safe.
// =============================================================================

import { adminDb } from "@/lib/db";
import { ChronikClient } from "chronik-client";
import { skeleton } from "./handleSkeleton";
import { priceForHandle } from "./handlePricing";
import { loadMintWallet, mintHandleChild } from "./mintHandleChild";
import { hostAsciiCard } from "./nft-art/hostAsciiCard"; // best-effort image host (Gen 1 ASCII card, seed = mint txid)
import { mintCapSoldOut, recordMintAgainstCap } from "./mintCap";
import { handleReservedByGrant } from "./grantReservation";
import { resolveOfficialAccount } from "./officialAccount";
import { contentHashHex } from "./feedProtocol";
import { CHRONIK_URLS } from "./ecash/chronikEndpoints";
import { addressHoldsToken } from "./heldHandles";

const OFFICIAL_HANDLE = "proofofwriting"; // byline for handle-mint feed cards
const PROFILE_URL_BASE = "https://proofofwriting.com/@"; // matches mintHandleChild's genesis url

// Don't re-broadcast a mint within this window of the last attempt: an accepted
// tx needs a few seconds to index, so we wait before deciding "it didn't land."
const MIN_RETRY_INTERVAL_MS = 90_000;
// Park a paid mint for manual review after this many failed attempts — still NOT
// refunded (the buyer paid; delivery is owed). Only genuine unavailability refunds.
const MAX_MINT_ATTEMPTS = 50;

const supabase = adminDb();

let _chronik: ChronikClient | null = null;
const chronik = () => (_chronik ??= new ChronikClient(CHRONIK_URLS));

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

/** Refund + mark refunded. The ONLY legitimate refund: delivery is impossible. */
async function refundUnavailable(
  wallet: any,
  m: any,
  reason: string,
): Promise<{ status: string; error?: string }> {
  const refundTxid = await refund(await synced(wallet), m.payer_address, Number(m.expected_sats));
  await supabase
    .from("pending_mints")
    .update({ status: refundTxid ? "refunded" : "failed", refund_txid: refundTxid, error: reason })
    .eq("id", m.id);
  return { status: refundTxid ? "refunded" : "failed", error: reason };
}

/** Direct on-chain check: has this handle ALREADY been delivered to the payer?
 *  (A prior attempt may have broadcast the genesis but died before recording it,
 *  so the `handles` table can't answer this — we read the chain instead.) Matches
 *  our unique profile URL / genesis name so a foreign NFT can never be mistaken
 *  for one of ours. Bounded so a whale wallet can't stall the mint. */
async function deliveredChildTokenId(payerAddress: string, handle: string): Promise<string | null> {
  try {
    const addr = payerAddress.startsWith("ecash:") ? payerAddress : `ecash:${payerAddress}`;
    const res: any = await chronik().address(addr).utxos();
    const ids = new Set<string>();
    for (const u of res?.utxos ?? []) {
      const id = u?.token?.tokenId;
      if (id) ids.add(String(id));
    }
    const ourUrl = PROFILE_URL_BASE + handle;
    let scanned = 0;
    for (const id of ids) {
      if (scanned++ >= 40) break; // bound the per-attempt Chronik work
      try {
        const meta: any = await chronik().token(id);
        const type = String(meta?.tokenType?.type ?? "");
        const gi = meta?.genesisInfo ?? {};
        if (type.includes("NFT1_CHILD") && (gi.url === ourUrl || gi.tokenName === handle)) return id;
      } catch {
        /* skip an unreadable token */
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Record + finish a delivered mint: write the handles registry row, mark the
 * pending_mint minted, host the card image, and post the mint feed card. Every
 * step is idempotent and best-effort AFTER delivery — none of them may fail (or
 * refund) a mint whose NFT is already on-chain. `fresh` = this call broadcast the
 * mint (so it should count against the 10K cap); an adopt/retry passes false.
 */
async function finalizeDelivered(
  m: any,
  childTokenId: string,
  sk: string,
  opts: { fresh: boolean },
): Promise<void> {
  const { tier } = priceForHandle(m.handle);

  // 1. handles registry row (source of truth that the name is taken). Idempotent:
  //    a duplicate (already recorded) is fine; only a genuinely-new row counts
  //    toward the cap. A transient DB error is logged, not thrown — the NFT is
  //    already delivered, and this row can be backfilled.
  let insertedNew = false;
  const ins = await supabase
    .from("handles")
    .insert({ token_id: childTokenId, handle: m.handle, handle_skeleton: sk, origin: "mint", tier, mint_txid: childTokenId })
    .select("token_id");
  if (ins.error) {
    if (ins.error.code !== "23505") {
      console.error("[mintProcessor] handles insert failed (NFT delivered; backfill needed):", childTokenId, ins.error.message);
    }
  } else if (ins.data && ins.data.length === 1) {
    insertedNew = true;
  }

  // 2. count against the 10K cap — ONLY for a fresh mint that created a new row,
  //    so an adopt/retry can never double-count (and never rolls back on failure).
  if (opts.fresh && insertedNew) {
    try { await recordMintAgainstCap(); } catch (e) { console.warn("[mintProcessor] cap count failed (non-fatal):", e); }
  }

  // 3. best-effort image (deterministic, so safe to backfill if it fails)
  let imageUrl: string | null = m.image_url ?? null;
  if (!imageUrl) {
    try { imageUrl = await hostAsciiCard(m.handle, childTokenId); } catch { imageUrl = null; }
  }

  // 4. mark the mint delivered
  await supabase
    .from("pending_mints")
    .update({ status: "minted", child_token_id: childTokenId, image_url: imageUrl })
    .eq("id", m.id);

  // 5. mint feed card — dedup on txid so a retry/adopt can't double-post it.
  try {
    const { data: existingCard } = await supabase.from("feed_posts").select("txid").eq("txid", childTokenId).maybeSingle();
    if (!existingCard) {
      const official = await resolveOfficialAccount(supabase);
      if (official) {
        const priceXec = Number(m.expected_sats) / 100;
        const content = `@${m.handle} minted · ${priceXec.toLocaleString("en-US")} XEC`;
        await supabase.from("feed_posts").insert({
          txid: childTokenId,
          action: 1,
          content,
          content_hash: contentHashHex(content),
          card_kind: "handle_mint",
          image_url: imageUrl,
          card_meta: { handle: m.handle, tier, priceXec, minterAddress: m.payer_address },
          author_account_id: official.accountId,
          author_identity: `@${OFFICIAL_HANDLE}`,
          payer_address: official.address,
          payout_address: official.address,
          amount_sats: 0,
          finalized_at: new Date().toISOString(),
        });
      } else {
        console.warn("[mintProcessor] official account not found — skipped mint feed card (run scripts/ensure-official-account.ts)");
      }
    }
  } catch (e) {
    console.warn("[mintProcessor] mint feed-card insert failed (non-fatal):", e instanceof Error ? e.message : e);
  }
}

/**
 * Process one paid mint. Idempotent: only acts on rows still in 'paid', and never
 * re-broadcasts a mint that already landed. Retries transient failures (keeps the
 * row 'paid'); refunds ONLY genuine unavailability; parks a chronically-failing
 * row as 'stuck' for manual review (never refunds it).
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
    const attempts = Number(m.attempts ?? 0);

    // ---- availability / delivery reconciliation ----
    const [{ data: existing }, { data: reserved }, grantReserved] = await Promise.all([
      supabase.from("handles").select("token_id").eq("handle_skeleton", sk).limit(1).maybeSingle(),
      supabase.from("reserved_handles").select("handle_skeleton").eq("handle_skeleton", sk).limit(1).maybeSingle(),
      handleReservedByGrant(supabase, sk),
    ]);
    if (existing?.token_id) {
      // The name is registered. If THIS payer holds it, a prior attempt of THIS
      // mint already delivered it → finish idempotently (no re-mint, no refund).
      if (m.payer_address && (await addressHoldsToken(m.payer_address, existing.token_id))) {
        await finalizeDelivered(m, existing.token_id, sk, { fresh: false });
        return { status: "minted", childTokenId: existing.token_id };
      }
      // Held by someone else → genuinely unavailable → the one legitimate refund.
      return await refundUnavailable(wallet, m, "name was no longer available");
    }
    if (reserved || grantReserved) return await refundUnavailable(wallet, m, "name was reserved");

    // 10K hard cap: once live and sold out, don't mint — refund. No-op pre-launch.
    if (await mintCapSoldOut()) return await refundUnavailable(wallet, m, "collection sold out");

    // ---- retry safety: did a prior attempt already broadcast the mint? ----
    if (attempts > 0) {
      // Cheap gate first: if the last attempt was very recent, WAIT — an in-flight
      // broadcast needs time to index before a re-mint is double-mint-safe. This
      // returns without an on-chain scan, so the client's rapid polling can't
      // hammer Chronik during the wait.
      const last = m.last_attempt_at ? new Date(m.last_attempt_at).getTime() : 0;
      if (Date.now() - last < MIN_RETRY_INTERVAL_MS) return { status: "processing" };

      // Interval passed → check the chain before re-minting. A prior attempt may
      // have broadcast the genesis but died before recording it; adopt it rather
      // than mint a second NFT of the same name.
      const delivered = m.payer_address ? await deliveredChildTokenId(m.payer_address, m.handle) : null;
      if (delivered) {
        await finalizeDelivered(m, delivered, sk, { fresh: true });
        return { status: "minted", childTokenId: delivered };
      }
      // Chronically failing → park for manual review (NOT a refund; the buyer paid).
      if (attempts >= MAX_MINT_ATTEMPTS) {
        await supabase.from("pending_mints").update({ status: "stuck" }).eq("id", mintId);
        return { status: "stuck" };
      }
    }

    // ---- mint ----
    // Record the attempt BEFORE broadcasting, so the retry spacing + counter hold
    // even if this process dies mid-broadcast (→ next attempt waits, then checks
    // the chain before re-minting).
    await supabase
      .from("pending_mints")
      .update({ attempts: attempts + 1, last_attempt_at: new Date().toISOString() })
      .eq("id", mintId);
    m.attempts = attempts + 1;

    const res = await mintHandleChild(wallet, {
      handle: m.handle,
      buyerAddress: m.payer_address,
      groupTokenId: process.env.GROUP_TOKEN_ID!,
    });

    await finalizeDelivered(m, res.childTokenId, sk, { fresh: true });
    return { status: "minted", childTokenId: res.childTokenId };
  } catch (e: any) {
    // TRANSIENT failure → RETRY, never refund. Leave the row 'paid' so the
    // reconciler re-runs it; only park it 'stuck' after many attempts. The
    // attempt was already counted above, so the next run waits out the retry
    // interval and re-checks the chain before re-minting (no double-mint).
    const attempts = Number(m.attempts ?? 0);
    const patch: any = { error: String(e?.message ?? e) };
    if (attempts >= MAX_MINT_ATTEMPTS) patch.status = "stuck";
    await supabase.from("pending_mints").update(patch).eq("id", mintId);
    return { status: attempts >= MAX_MINT_ATTEMPTS ? "stuck" : "processing", error: String(e?.message ?? e) };
  } finally {
    await releaseMintLock(holder);
  }
}

async function synced(wallet: any) { await wallet.sync(); return wallet; }

/**
 * Atomically claim a name for a just-detected payment, then deliver — or refund
 * the loser of a double-buy race. Called the moment a payment confirms (the mint
 * status poll + the reconciler). The partial unique index on
 * pending_mints(handle_skeleton) WHERE status IN ('paid','stuck') guarantees only
 * ONE payment can hold the claim: a second payment for the same name trips a
 * unique violation on its flip here and is refunded, since it can never be
 * delivered (the name is already someone else's). The winner flows straight into
 * the normal serialized delivery.
 */
export async function claimPaidOrRefund(
  mintId: string,
  payerAddress: string,
  paymentTxid: string,
): Promise<{ status: string; childTokenId?: string; error?: string }> {
  const { error } = await supabase
    .from("pending_mints")
    .update({ status: "paid", payer_address: payerAddress, payment_txid: paymentTxid })
    .eq("id", mintId)
    .eq("status", "pending")
    .select("id");

  if (error) {
    // Unique-violation on the active-claim index → another payment already claimed
    // this name. This one lost the race and can never be delivered → refund it.
    if (error.code === "23505") {
      await supabase
        .from("pending_mints")
        .update({ status: "contended", payer_address: payerAddress, payment_txid: paymentTxid, error: "name was claimed by an earlier payment" })
        .eq("id", mintId)
        .eq("status", "pending");
      return await refundContended(mintId);
    }
    // A transient DB error — leave the row 'pending' and let the caller re-poll.
    return { status: "awaiting_payment", error: error.message };
  }

  // Whether or not THIS call flipped it (a concurrent poll may have won the flip),
  // the row is now paid → run the delivery.
  return await processPaidMint(mintId);
}

/**
 * Refund a contended loser under the mint_lock, so the refund can't race a
 * concurrent mint on the wallet's UTXOs. Best-effort: if the lock is busy or the
 * broadcast fails, the row stays 'contended' and the reconciler retries it.
 */
export async function refundContended(mintId: string): Promise<{ status: string; error?: string }> {
  const { data: m } = await supabase
    .from("pending_mints")
    .select("expected_sats, payer_address, status")
    .eq("id", mintId)
    .maybeSingle();
  if (!m) return { status: "not_found" };
  if (m.status !== "contended") return { status: m.status }; // already handled

  const holder = LOCK_HOLDER();
  if (!(await claimMintLock(holder))) return { status: "contended" }; // busy → reconciler retries
  try {
    const wallet = loadMintWallet(CHRONIK_URLS, {
      mnemonic: process.env.MINT_WALLET_MNEMONIC,
      skHex: process.env.MINT_WALLET_SK,
    });
    const refundTxid = await refund(await synced(wallet), m.payer_address, Number(m.expected_sats));
    if (!refundTxid) return { status: "contended", error: "refund broadcast failed; will retry" };
    await supabase
      .from("pending_mints")
      .update({ status: "refunded", refund_txid: refundTxid })
      .eq("id", mintId)
      .eq("status", "contended");
    return { status: "refunded", error: "name was claimed by an earlier payment" };
  } finally {
    await releaseMintLock(holder);
  }
}
