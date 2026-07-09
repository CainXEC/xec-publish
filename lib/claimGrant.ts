// =============================================================================
//  claimGrant.ts
//  Grandfather claim, in two steps — code + PROVEN key control (no typed address).
//
//   1. startClaim({handle, code})  -> verifies the one-time code, then asks the
//      author to send a tiny unique dust tx to the platform proof address.
//   2. pollClaim({handle, txid?})  -> detects that tx, reads the SENDER address
//      off-chain (only the key-holder could have signed it), and mints the handle
//      NFT to exactly that address.
//
//  This is the same wallet-only proof-of-control used for paid mints and every
//  new signup: a grandfathered author can only ever receive their handle at an
//  address they demonstrably hold the keys for — because they had to spend from
//  it. With no email recovery, that guarantee matters.
//
//  Authorization to claim = the one-time code (bearer secret you send privately).
//  Delivery address        = whatever wallet the author sends the proof from.
//
//  The grant's legacy_author_ref carries the legacy authors.id this handle
//  belongs to; on a successful claim we bind the new account to that author
//  (accounts.author_id) so the /@handle profile resolves to their posts.
//
//  Serialized by the SAME global mint_lock as paid mints (group-UTXO race). This
//  is the ONE place a reserved name is allowed to mint.
//
//  Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GROUP_TOKEN_ID,
//       MINT_PAYMENT_ADDRESS (reused as the proof address),
//       MINT_WALLET_MNEMONIC | MINT_WALLET_SK, CLAIM_WINDOW_ENDS (ISO date).
// =============================================================================

import { createClient } from "@supabase/supabase-js";
import { createHash, timingSafeEqual, randomUUID } from "node:crypto";
import { skeleton, displayHandle, validateHandleSyntax } from "./handleSkeleton";
import { priceForHandle } from "./handlePricing";
import { loadMintWallet, mintHandleChild } from "./mintHandleChild";
import { hostAsciiCard } from "./nft-art/hostAsciiCard"; // Gen 1 ASCII card, seed = mint txid (matches mintProcessor)
import { findMintPayment, verifyMintTxid } from "./mintPayments";
import { encodePostIdOpReturnRaw } from "./opReturnEncode";
import { mintCapSoldOut, recordMintAgainstCap } from "./mintCap";

import { CHRONIK_URLS } from "@/lib/ecash/chronikEndpoints";
const supabase = createClient((process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL)!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const PROOF_ADDRESS = process.env.MINT_PAYMENT_ADDRESS!;
const CLAIM_WINDOW_ENDS = process.env.CLAIM_WINDOW_ENDS ? Date.parse(process.env.CLAIM_WINDOW_ENDS) : Infinity;
const PROOF_MINUTES = 20;

// ---- global mint lock (mirrors mintProcessor) ------------------------------
const LOCK_HOLDER = () => `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
async function claimMintLock(holder: string): Promise<boolean> {
  const now = new Date().toISOString();
  const until = new Date(Date.now() + 45_000).toISOString();
  const { data } = await supabase.from("mint_lock").update({ locked_until: until, holder }).eq("id", 1)
    .or(`locked_until.is.null,locked_until.lt.${now}`).select("id");
  return Array.isArray(data) && data.length === 1;
}
async function releaseMintLock(holder: string) {
  await supabase.from("mint_lock").update({ locked_until: null, holder: null }).eq("id", 1).eq("holder", holder);
}

// ---- helpers ---------------------------------------------------------------
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
function codeMatches(code: string, hash: string): boolean {
  try { const a = Buffer.from(sha256(code), "hex"), b = Buffer.from(hash, "hex"); return a.length === b.length && timingSafeEqual(a, b); }
  catch { return false; }
}

// Assign a dust amount unique among currently-active claims so detection can't
// cross-match two authors proving at the same time. 6.00–14.99 XEC.
async function assignProofSats(): Promise<number> {
  const nowIso = new Date().toISOString();
  const { data: active } = await supabase.from("claim_grants")
    .select("proof_sats").eq("status", "awaiting_proof").gt("proof_expires_at", nowIso).not("proof_sats", "is", null);
  const used = new Set((active ?? []).map((a: any) => a.proof_sats));
  for (let i = 0; i < 60; i++) { const v = 600 + Math.floor(Math.random() * 900); if (!used.has(v)) return v; }
  return 600 + Math.floor(Math.random() * 900);
}

async function loadGrant(sk: string) {
  const { data } = await supabase.from("claim_grants")
    .select("handle, code_hash, status, proof_sats, proof_nonce, proof_txid, proof_started_unix, proof_expires_at, claimed_token_id, claimed_address, legacy_author_ref")
    .eq("handle_skeleton", sk).maybeSingle();
  return data as any;
}

/** The grant's legacy_author_ref IS the authors.id (set by the seeder). Verify it
 *  points at a real author; return null if unset/unknown so binding still works. */
async function resolveGrantAuthorId(grant: any): Promise<string | null> {
  const ref = grant?.legacy_author_ref;
  if (!ref || typeof ref !== "string") return null;
  const { data } = await supabase.from("authors").select("id").eq("id", ref).maybeSingle();
  return (data?.id as string) ?? null;
}

// ---------------------------------------------------------------- step 1
export type StartResult =
  | { ok: true; handle: string; proofAddress: string; proofSats: number; amountXec: string; bip21: string; expiresAt: string }
  | { ok: false; code: "window_closed" | "not_claimable" | "bad_code" | "already_claimed" | "taken"; error: string };

export async function startClaim(input: { handle: string; code: string }): Promise<StartResult> {
  const handle = displayHandle(input.handle ?? "");
  if (validateHandleSyntax(handle)) return { ok: false, code: "not_claimable", error: "That isn’t a valid handle." };
  const sk = skeleton(handle);
  if (Date.now() > CLAIM_WINDOW_ENDS) return { ok: false, code: "window_closed", error: "The claim window has closed." };

  const grant = await loadGrant(sk);
  if (!grant) return { ok: false, code: "not_claimable", error: "That handle isn’t reserved for claiming." };
  if (grant.status === "claimed") return { ok: false, code: "already_claimed", error: "This handle has already been claimed." };
  if (!codeMatches((input.code ?? "").trim(), grant.code_hash)) return { ok: false, code: "bad_code", error: "That claim code doesn’t match this handle." };

  const { data: taken } = await supabase.from("handles").select("token_id").eq("handle_skeleton", sk).maybeSingle();
  if (taken) return { ok: false, code: "taken", error: "This handle has already been minted." };

  const proofSats = await assignProofSats();
  // Per-round nonce (UUID) that tags THIS proof round in OP_RETURN, so detection
  // binds to the exact tx we asked for — not merely any dust of the same amount
  // hitting the shared proof address (== MINT_PAYMENT_ADDRESS, which also
  // receives mint/unlock payments). Regenerated every start, so an old round's
  // proof tx can never satisfy a fresh challenge (replay protection).
  const proofNonce = randomUUID();
  const startedUnix = Math.floor(Date.now() / 1000);
  const expiresAt = new Date(Date.now() + PROOF_MINUTES * 60_000).toISOString();
  await supabase.from("claim_grants").update({
    status: "awaiting_proof", proof_sats: proofSats, proof_nonce: proofNonce, proof_started_unix: startedUnix, proof_expires_at: expiresAt,
    // Clear any stale proof-captured marker from a prior attempt that died mid-mint,
    // so this fresh proof round starts in detection, not straight into minting.
    claimed_address: null, proof_txid: null,
  }).eq("handle_skeleton", sk);

  const amountXec = (proofSats / 100).toFixed(2);
  const opReturnRaw = encodePostIdOpReturnRaw(proofNonce);
  return { ok: true, handle: grant.handle, proofAddress: PROOF_ADDRESS, proofSats, amountXec, bip21: `${PROOF_ADDRESS}?amount=${amountXec}&op_return_raw=${opReturnRaw}`, expiresAt };
}

// ---------------------------------------------------------------- step 2
export type PollResult =
  | { ok: true; status: "awaiting_proof" }
  | { ok: true; status: "finalizing" }
  | { ok: true; status: "minting" }
  | { ok: true; status: "expired" }
  | { ok: true; status: "claimed"; handle: string; childTokenId: string; imageUrl: string | null; address: string }
  | { ok: false; status: "error"; error: string };

export async function pollClaim(input: { handle: string; txid?: string }): Promise<PollResult> {
  const handle = displayHandle(input.handle ?? "");
  const sk = skeleton(handle);
  const grant = await loadGrant(sk);
  if (!grant) return { ok: false, status: "error", error: "Unknown handle." };
  if (grant.status === "claimed") {
    return { ok: true, status: "claimed", handle: grant.handle, childTokenId: grant.claimed_token_id, imageUrl: null, address: "" };
  }
  if (grant.status !== "awaiting_proof") return { ok: false, status: "error", error: "Start a claim first." };

  // DURABLE "proof captured — minting" state. Once a prior poll has verified the
  // proof and written the delivery address, we're past detection: drive/await the
  // mint. This mirrors the mint page's pending_mints flip to `paid` — a state that
  // persists in the row across polls, so the client reliably renders the minting
  // spinner even when the dev server serializes requests (no reliance on the ~2s
  // finality window or on concurrent in-flight polls).
  if (grant.claimed_address) {
    return await runMint(sk, grant, grant.claimed_address);
  }

  if (grant.proof_expires_at && Date.parse(grant.proof_expires_at) < Date.now()) {
    await supabase.from("claim_grants").update({ status: "unclaimed", proof_sats: null, proof_started_unix: null, proof_expires_at: null }).eq("handle_skeleton", sk);
    return { ok: true, status: "expired" };
  }

  // detect the proof tx and read the SENDER address (proof of key control).
  // Match on THIS round's OP_RETURN nonce (grant.proof_nonce), not just the
  // amount — an untagged coincidental payment of the same value to the shared
  // proof address can no longer be mistaken for the claim proof.
  const det = input.txid
    ? await verifyMintTxid(input.txid, PROOF_ADDRESS, grant.proof_sats, grant.proof_nonce ?? undefined)
    : await findMintPayment(PROOF_ADDRESS, grant.proof_nonce ?? null, grant.proof_sats, grant.proof_started_unix);
  if (!det?.payerAddress) return { ok: true, status: "awaiting_proof" };

  // Hold the mint until the proof tx is Avalanche-final. Until then it could be
  // replaced by a conflicting double-spend, so keep the client polling. We've now
  // SEEN the proof tx, so surface a distinct "finalizing" signal (mirrors the mint
  // page's post-payment wait) rather than the pre-payment "awaiting_proof".
  if (!det.isFinal) return { ok: true, status: "finalizing" };

  // Proof seen AND final: capture the delivery address DURABLY and return without
  // minting in this request. The next poll sees claimed_address set and performs
  // the (several-second) mint, guaranteeing the client shows a "minting" frame in
  // between — the mint page's detect-then-process split, done with an existing
  // column instead of a new status value (status is CHECK-constrained).
  // Record the proof txid alongside the delivery address. proof_txid carries a
  // UNIQUE constraint, so a single on-chain tx can back at most one claim — a
  // DB-level backstop against replaying one proof across grants even if the
  // nonce/amount guards were somehow bypassed. A conflict here means this tx is
  // already committed to another claim: don't mint, keep polling.
  const { error: capErr } = await supabase.from("claim_grants")
    .update({ claimed_address: det.payerAddress, proof_txid: det.txid })
    .eq("handle_skeleton", sk).eq("status", "awaiting_proof").is("claimed_address", null);
  if (capErr) return { ok: true, status: "awaiting_proof" };
  return { ok: true, status: "minting" };
}

// ---------------------------------------------------------------- mint core
// Perform (or await) the mint for a grant whose proof address is already captured.
// Serialized by the global mint_lock: the poll that holds the lock does the work;
// any other poll that can't get the lock reports "minting" so the spinner holds.
async function runMint(sk: string, grant: any, address: string): Promise<PollResult> {
  const holder = LOCK_HOLDER();
  // Another poll is already minting under the lock — keep the spinner up.
  if (!(await claimMintLock(holder))) return { ok: true, status: "minting" };
  try {
    // re-check under the lock
    const [{ data: taken2 }, grant2] = await Promise.all([
      supabase.from("handles").select("token_id").eq("handle_skeleton", sk).maybeSingle(),
      loadGrant(sk),
    ]);
    // Our own claim already completed (this or a concurrent poll finished it).
    if (grant2?.status === "claimed") {
      return { ok: true, status: "claimed", handle: grant2.handle, childTokenId: grant2.claimed_token_id, imageUrl: null, address };
    }
    if (taken2) {
      // Minted out from under us by someone else — clear the marker and report it.
      await supabase.from("claim_grants").update({ claimed_address: null }).eq("handle_skeleton", sk).eq("status", "awaiting_proof");
      return { ok: false, status: "error", error: "This handle has already been minted." };
    }

    // 10K hard cap: grandfather claims draw from the same collection supply, so
    // honor the cap here too (no-op pre-launch). Clear the captured marker so the
    // grant isn't stranded mid-mint.
    if (await mintCapSoldOut()) {
      await supabase.from("claim_grants").update({ claimed_address: null }).eq("handle_skeleton", sk).eq("status", "awaiting_proof");
      return { ok: false, status: "error", error: "The collection is sold out." };
    }

    // which legacy author does this grant belong to? (contract: legacy_author_ref = authors.id)
    const authorId = await resolveGrantAuthorId(grant2 ?? grant);

    const wallet = loadMintWallet(CHRONIK_URLS, { mnemonic: process.env.MINT_WALLET_MNEMONIC, skHex: process.env.MINT_WALLET_SK });
    const res: any = await mintHandleChild(wallet, { handle: grant.handle, buyerAddress: address, groupTokenId: process.env.GROUP_TOKEN_ID! });
    const childTokenId: string = res.childTokenId;

    const accountId = await bindAuthorAccount(address, childTokenId, grant.handle, authorId);
    const { tier } = priceForHandle(grant.handle);
    await supabase.from("handles").insert({
      token_id: childTokenId, handle: grant.handle, handle_skeleton: sk,
      origin: "grandfather", tier, mint_txid: childTokenId, minted_for_account_id: accountId,
    });

    // count this claim against the 10K cap (no-op pre-launch)
    await recordMintAgainstCap();

    let imageUrl: string | null = null;
    try { imageUrl = await hostAsciiCard(grant.handle, childTokenId); } catch { /* backfill later */ }

    await supabase.from("claim_grants").update({
      status: "claimed", claimed_address: address, claimed_account_id: accountId,
      claimed_token_id: childTokenId, claimed_at: new Date().toISOString(),
    }).eq("handle_skeleton", sk);

    return { ok: true, status: "claimed", handle: grant.handle, childTokenId, imageUrl, address };
  } catch (e: any) {
    // Mint failed — clear the captured address so the next poll re-detects and the
    // author can retry, rather than being stranded in a permanent minting state.
    await supabase.from("claim_grants").update({ claimed_address: null }).eq("handle_skeleton", sk).eq("status", "awaiting_proof");
    return { ok: false, status: "error", error: e?.message ?? "The mint failed — please try again." };
  } finally {
    await releaseMintLock(holder);
  }
}

/** Bind the proven address to an account (upgrading a reader account if the wallet
 *  already existed), set the claimed handle as its active display identity, and —
 *  when known — link it to the legacy author so the profile resolves to their posts. */
async function bindAuthorAccount(address: string, tokenId: string, handle: string, authorId: string | null): Promise<string> {
  const now = new Date().toISOString();
  const { data: link } = await supabase.from("account_addresses").select("account_id").eq("address", address).maybeSingle();
  if (link?.account_id) {
    const patch: any = { active_handle_token_id: tokenId, display_handle: handle, display_handle_checked_at: now, updated_at: now };
    if (authorId) patch.author_id = authorId;
    await supabase.from("accounts").update(patch).eq("id", link.account_id);
    return link.account_id as string;
  }
  const insert: any = { active_handle_token_id: tokenId, display_handle: handle, display_handle_checked_at: now };
  if (authorId) insert.author_id = authorId;
  const { data: acct } = await supabase.from("accounts").insert(insert).select("id").single();
  const accountId = acct!.id as string;
  await supabase.from("account_addresses").insert({ account_id: accountId, address, is_primary: true, verified_at: now });
  return accountId;
}
