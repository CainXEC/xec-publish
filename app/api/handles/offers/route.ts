// =============================================================================
//  app/api/handles/offers/route.ts — read the offer state for one handle.
//
//  GET ?tokenId=<64hex>
//
//  Three visibility tiers in one response:
//    • everyone:        count of open offers (never any amounts)
//    • the signed-in caller: their own offer, if any ("mine")
//    • the CURRENT HOLDER:   the full list — bidder byline + amount + when.
//      Holdership is resolved live (Chronik → account), so a handle that
//      changed wallets shows its offers to the new holder automatically.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/db";
import { getAuthedAccount } from "@/lib/authHelpers";
import { bidderDisplayMap, holderAccountIdForToken } from "@/lib/handleOffers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabase = adminDb();

type OfferRow = {
  bidder_account_id: string;
  amount_sats: number | null;
  updated_at: string;
};

export async function GET(req: NextRequest) {
  const tokenId = String(req.nextUrl.searchParams.get("tokenId") ?? "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(tokenId)) {
    return NextResponse.json({ ok: false, error: "bad token id" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("handle_offers")
    .select("bidder_account_id, amount_sats, updated_at")
    .eq("token_id", tokenId)
    .eq("status", "open")
    .order("updated_at", { ascending: false });

  if (error) {
    // Most likely: sql/handle_offers.sql not applied yet.
    console.error("[handle-offers] read failed", error.message);
    return NextResponse.json({ ok: false, error: "offers aren't available yet" }, { status: 503 });
  }

  const rows = (data ?? []) as OfferRow[];
  const acct = await getAuthedAccount();

  const mineRow = acct ? rows.find((r) => r.bidder_account_id === acct.accountId) : null;
  const mine = mineRow
    ? { amountXec: mineRow.amount_sats == null ? null : mineRow.amount_sats / 100 }
    : null;

  // Holder view: amounts + bidder bylines, newest first.
  let holder = false;
  let offers: Array<{ bidder: string; amountXec: number | null; at: string }> | undefined;
  if (acct) {
    const holderAccountId = await holderAccountIdForToken(supabase, tokenId);
    if (holderAccountId && holderAccountId === acct.accountId) {
      holder = true;
      const displays = await bidderDisplayMap(
        supabase,
        rows.map((r) => r.bidder_account_id)
      );
      offers = rows.map((r) => ({
        bidder: displays.get(r.bidder_account_id) ?? "a collector",
        amountXec: r.amount_sats == null ? null : r.amount_sats / 100,
        at: r.updated_at,
      }));
    }
  }

  return NextResponse.json({ ok: true, count: rows.length, mine, holder, offers });
}
