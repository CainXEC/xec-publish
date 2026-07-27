// =============================================================================
//  app/api/pocket/register/route.ts
//  POST -> link the caller's browser-derived Pocket address to their account.
//
//  Security model (two proofs, mirroring change-address):
//    1. CHALLENGE-scope session — adding a spending alias is identity-surface
//       mutation; a weaker pay-minted session can't do it.
//    2. proofSig — a signMsg signature over a string binding (accountId,
//       pocketAddress), made BY THE POCKET KEY. Without possession-proof, a
//       logged-in attacker could register a STRANGER'S address as "their
//       pocket": stealing that address's future payment attribution and, via
//       kind='pocket', blocking it from ever logging in.
//
//  The pocket PRIVATE key never appears here — only the derived pubkey and a
//  signature made with it. The RPC (sql/pocket_wallets.sql) enforces the DB
//  invariants: non-primary link, kind='pocket', one pocket per account,
//  explicit-only replacement, empty-shell absorption.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/db";
import { verifyMsg, shaRmd160, toHex, fromHex } from "ecash-lib";
import { decodeCashAddress } from "ecashaddrjs";
import { getChallengeSession } from "@/lib/session";
import { primaryAddressForAccount } from "@/lib/walletAuth";
import { buildRegisterProofString } from "@/lib/pocket/derive";
import { rateLimit, getClientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabase = adminDb();

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  if (!(await rateLimit(ip, 10, 60, "pocket-register"))) {
    return NextResponse.json({ ok: false, error: "Too many attempts. Try again shortly." }, { status: 429 });
  }

  const claim = await getChallengeSession();
  if (!claim) {
    return NextResponse.json(
      { ok: false, error: "Log in with your main wallet first (a pay-unlocked session can't set up a Pocket)." },
      { status: 403 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body" }, { status: 400 });
  }

  const rawAddress = typeof body?.address === "string" ? body.address.trim().toLowerCase() : "";
  const pubkey = typeof body?.pubkey === "string" ? body.pubkey.trim().toLowerCase() : "";
  const proofSig = typeof body?.proofSig === "string" ? body.proofSig.trim() : "";
  const replace = body?.replace === true;

  const bare = rawAddress.replace(/^ecash:/, "");
  const prefixed = `ecash:${bare}`;

  // --- shape checks -----------------------------------------------------------
  if (!/^[0-9a-f]{66}$/.test(pubkey)) {
    return NextResponse.json({ ok: false, error: "Invalid pocket pubkey" }, { status: 400 });
  }
  let decoded: ReturnType<typeof decodeCashAddress>;
  try {
    decoded = decodeCashAddress(prefixed);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid pocket address" }, { status: 400 });
  }
  if (decoded.type !== "p2pkh") {
    return NextResponse.json({ ok: false, error: "Pocket must be a P2PKH address" }, { status: 400 });
  }

  // pubkey ↔ address binding: the address must BE this pubkey's P2PKH.
  const hash160 = toHex(shaRmd160(fromHex(pubkey)));
  if (hash160 !== String(decoded.hash).toLowerCase()) {
    return NextResponse.json({ ok: false, error: "Pubkey does not match the pocket address" }, { status: 400 });
  }

  // Never let the account's own primary be marked as a pocket (login lockout).
  const primary = await primaryAddressForAccount(claim.accountId, "");
  if (primary && primary.toLowerCase().replace(/^ecash:/, "") === bare) {
    return NextResponse.json(
      { ok: false, error: "That's your main wallet address — a Pocket must be its own derived address." },
      { status: 400 },
    );
  }

  // --- possession proof --------------------------------------------------------
  const proofString = buildRegisterProofString(claim.accountId, bare);
  let proofOk = false;
  try {
    proofOk = verifyMsg(proofString, proofSig, prefixed) === true;
  } catch {
    proofOk = false;
  }
  if (!proofOk) {
    return NextResponse.json({ ok: false, error: "Pocket possession proof failed" }, { status: 403 });
  }

  // --- pre-check for a friendlier 409 (the RPC re-checks transactionally) ------
  const { data: existing } = await supabase
    .from("pocket_wallets")
    .select("address, pubkey")
    .eq("account_id", claim.accountId)
    .maybeSingle();
  if (existing && existing.address.toLowerCase().replace(/^ecash:/, "") !== bare && !replace) {
    return NextResponse.json(
      {
        ok: false,
        error: "pocket_conflict",
        currentPocket: { address: existing.address, pubkey: existing.pubkey },
      },
      { status: 409 },
    );
  }

  // --- link (atomic; see sql/pocket_wallets.sql) --------------------------------
  const { data: result, error: rpcError } = await supabase.rpc("link_pocket_address", {
    p_account_id: claim.accountId,
    p_address: prefixed,
    p_pubkey: pubkey,
    p_replace: replace,
  });

  if (rpcError) {
    const msg = String(rpcError.message ?? "");
    if (msg.includes("pocket_conflict")) {
      return NextResponse.json(
        { ok: false, error: "pocket_conflict", currentPocket: existing ?? null },
        { status: 409 },
      );
    }
    if (msg.includes("pocket_is_primary")) {
      return NextResponse.json(
        { ok: false, error: "That's your main wallet address — a Pocket must be its own derived address." },
        { status: 400 },
      );
    }
    if (msg.includes("pocket_has_account")) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "This pocket address already has account activity of its own, so it can't be attached automatically. Contact support.",
        },
        { status: 409 },
      );
    }
    if (msg.includes("address_in_use")) {
      return NextResponse.json(
        { ok: false, error: "That address already belongs to another account." },
        { status: 409 },
      );
    }
    console.error("[pocket-register] rpc failed", rpcError);
    return NextResponse.json({ ok: false, error: "Could not register the pocket." }, { status: 500 });
  }

  const outcome = (result ?? {}) as { already?: boolean; absorbed?: boolean };
  return NextResponse.json({
    ok: true,
    pocket: { address: prefixed, pubkey },
    already: outcome.already === true,
    absorbed: outcome.absorbed === true,
  });
}
