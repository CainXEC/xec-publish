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
//  Serialized by the SAME global mint_lock as paid mints (group-UTXO race). This
//  is the ONE place a reserved name is allowed to mint.
//
//  Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GROUP_TOKEN_ID,
//       MINT_PAYMENT_ADDRESS (reused as the proof address),
//       MINT_WALLET_MNEMONIC | MINT_WALLET_SK, CLAIM_WINDOW_ENDS (ISO date).
// =============================================================================

import { createClient } from "@supabase/supabase-js";
import { createHash, timingSafeEqual } from "node:crypto";
import { skeleton, displayHandle, validateHandleSyntax } from "./handleSkeleton";
import { priceForHandle } from "./handlePricing";
import { loadMintWallet, mintHandleChild } from "./mintHandleChild";
import { hostHandleCard } from "./hostHandleCard";
import { findMintPayment, verifyMintTxid } from "./mintPayments";

const CHRONIK_URLS = ["https://chronik.e.cash", "https://chronik-native.fabien.cash"];
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
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
    .select("handle, code_hash, status, proof_sats, proof_started_unix, proof_expires_at, claimed_token_id")
    .eq("handle_skeleton", sk).maybeSingle();
  return data as any;
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
  const startedUnix = Math.floor(Date.now() / 1000);
  const expiresAt = new Date(Date.now() + PROOF_MINUTES * 60_000).toISOString();
  await supabase.from("claim_grants").update({
    status: "awaiting_proof", proof_sats: proofSats, proof_started_unix: startedUnix, proof_expires_at: expiresAt,
  }).eq("handle_skeleton", sk);

  const amountXec = (proofSats / 100).toFixed(2);
  return { ok: true, handle: grant.handle, proofAddress: PROOF_ADDRESS, proofSats, amountXec, bip21: `${PROOF_ADDRESS}?amount=${amountXec}`, expiresAt };
}

// ---------------------------------------------------------------- step 2
export type PollResult =
  | { ok: true; status: "awaiting_proof" }
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
  if (grant.proof_expires_at && Date.parse(grant.proof_expires_at) < Date.now()) {
    await supabase.from("claim_grants").update({ status: "unclaimed", proof_sats: null, proof_started_unix: null, proof_expires_at: null }).eq("handle_skeleton", sk);
    return { ok: true, status: "expired" };
  }

  // detect the proof tx and read the SENDER address (proof of key control)
  const det = input.txid
    ? await verifyMintTxid(input.txid, PROOF_ADDRESS, grant.proof_sats)
    : await findMintPayment(PROOF_ADDRESS, grant.proof_sats, grant.proof_started_unix);
  if (!det?.payerAddress) return { ok: true, status: "awaiting_proof" };

  const verifiedAddress = det.payerAddress; // author demonstrably holds these keys

  const minted = await mintToVerified(sk, grant.handle, verifiedAddress);
  if (!minted.ok) return { ok: false, status: "error", error: minted.error };
  return { ok: true, status: "claimed", handle: grant.handle, childTokenId: minted.childTokenId, imageUrl: minted.imageUrl, address: verifiedAddress };
}

// ---------------------------------------------------------------- mint core
async function mintToVerified(sk: string, grantHandle: string, address: string): Promise<{ ok: true; childTokenId: string; imageUrl: string | null } | { ok: false; error: string }> {
  const holder = LOCK_HOLDER();
  if (!(await claimMintLock(holder))) return { ok: false, error: "A mint is in progress — try again in a moment." };
  try {
    // re-check under the lock
    const [{ data: taken2 }, grant2] = await Promise.all([
      supabase.from("handles").select("token_id").eq("handle_skeleton", sk).maybeSingle(),
      loadGrant(sk),
    ]);
    if (taken2) return { ok: false, error: "This handle has already been minted." };
    if (!grant2 || grant2.status === "claimed") return { ok: false, error: "This handle has already been claimed." };

    const wallet = loadMintWallet(CHRONIK_URLS, { mnemonic: process.env.MINT_WALLET_MNEMONIC, skHex: process.env.MINT_WALLET_SK });
    const res: any = await mintHandleChild(wallet, { handle: grantHandle, buyerAddress: address, groupTokenId: process.env.GROUP_TOKEN_ID! });
    const childTokenId: string = res.childTokenId;

    const accountId = await bindAuthorAccount(address, childTokenId, grantHandle);
    const { tier } = priceForHandle(grantHandle);
    await supabase.from("handles").insert({
      token_id: childTokenId, handle: grantHandle, handle_skeleton: sk,
      origin: "grandfather", tier, mint_txid: childTokenId, minted_for_account_id: accountId,
    });

    let imageUrl: string | null = null;
    try { imageUrl = await hostHandleCard(grantHandle, childTokenId); } catch { /* backfill later */ }

    await supabase.from("claim_grants").update({
      status: "claimed", claimed_address: address, claimed_account_id: accountId,
      claimed_token_id: childTokenId, claimed_at: new Date().toISOString(),
    }).eq("handle_skeleton", sk);

    return { ok: true, childTokenId, imageUrl };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "The mint failed — please try again." };
  } finally {
    await releaseMintLock(holder);
  }
}

/** Bind the proven address to an account (upgrading a reader account if the wallet
 *  already existed), set the claimed handle as its active display identity. */
async function bindAuthorAccount(address: string, tokenId: string, handle: string): Promise<string> {
  const now = new Date().toISOString();
  const { data: link } = await supabase.from("account_addresses").select("account_id").eq("address", address).maybeSingle();
  if (link?.account_id) {
    await supabase.from("accounts").update({ kind: "author", active_handle_token_id: tokenId, display_handle: handle, display_handle_checked_at: now, updated_at: now }).eq("id", link.account_id);
    return link.account_id as string;
  }
  const { data: acct } = await supabase.from("accounts").insert({ kind: "author", active_handle_token_id: tokenId, display_handle: handle, display_handle_checked_at: now }).select("id").single();
  const accountId = acct!.id as string;
  await supabase.from("account_addresses").insert({ account_id: accountId, address, is_primary: true, verified_at: now });
  return accountId;
}
