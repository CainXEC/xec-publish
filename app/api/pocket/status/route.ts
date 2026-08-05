// =============================================================================
//  app/api/pocket/status/route.ts
//  GET -> the logged-in account's registered Pocket (or null) + live primary.
//
//  Read-only, any session scope. Two consumers:
//    - the restore flow: after re-deriving from a pasted signature, the client
//      compares its derived address against `pocket.address` — a mismatch
//      means the wrong wallet signed OR ecash-lib's deterministic signing
//      changed, and the client FREEZES instead of silently minting a new
//      pocket (the DB registry stands in for "the last on-chain DELEGATE").
//    - the chip/panel: "is a pocket registered for this account?"
// =============================================================================

import { NextResponse } from "next/server";
import { adminDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { primaryAddressForAccount } from "@/lib/walletAuth";
import { getXecBalanceSats } from "@/lib/xecBalance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabase = adminDb();

export async function GET() {
  const claim = await getSession();
  if (!claim) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  const [{ data: pocket }, primaryAddress] = await Promise.all([
    supabase
      .from("pocket_wallets")
      .select("address, pubkey, delegate_txid, created_at")
      .eq("account_id", claim.accountId)
      .maybeSingle(),
    primaryAddressForAccount(claim.accountId, claim.address ?? ""),
  ]);

  // Server-truth balance for the registered pocket — independent of THIS
  // device's local pocket record, so a "you have funds here" warning (e.g.
  // before an address change) works even from a browser that never set the
  // pocket up locally. Only fetched when a pocket is actually registered.
  const balanceSats = pocket ? await getXecBalanceSats(pocket.address) : null;

  return NextResponse.json({
    ok: true,
    pocket: pocket
      ? {
          address: pocket.address,
          pubkey: pocket.pubkey,
          delegateTxid: pocket.delegate_txid ?? null,
          createdAt: pocket.created_at,
          balanceSats,
        }
      : null,
    primaryAddress: primaryAddress || null,
  });
}
