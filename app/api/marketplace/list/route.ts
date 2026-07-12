// =============================================================================
//  app/api/marketplace/list/route.ts
//  Public, read-only view of handles currently listed for sale on Agora.
//
//  Source of truth is the CHAIN: fetchActiveHandleOffers() returns every active
//  oneshot offer in the handle group, with its on-chain asked price. We join
//  those token ids to the `handles` table only to decorate each listing with
//  its handle text, tier, mint date and hosted card image. A listed handle that
//  somehow isn't in our table is skipped (we can't render it meaningfully).
//
//  No listings are stored here; buying/cancelling on-chain updates the list for
//  free on the next request. Sorting is by price (default) or newest-listed is
//  not knowable without extra history, so we offer price + mint-date sorts only.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { fetchActiveHandleOffers } from "@/lib/agoraMarketplace";
import { chronikBudget } from "@/lib/ecash/chronikBudget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabase = createClient(
  (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL)!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

export async function GET(req: NextRequest) {
  const sort = req.nextUrl.searchParams.get("sort") ?? "price-asc";

  // Budgeted chain read: Chronik/Agora down, misconfigured, OR merely hanging
  // — past the deadline the client gets its clean "try again" state instead
  // of a page held hostage by a stalled indexer.
  const offers = await chronikBudget(fetchActiveHandleOffers(), 2500, null);
  if (offers === null) {
    return NextResponse.json(
      { ok: false, error: "the market is refreshing — try again in a moment" },
      { status: 503 }
    );
  }

  if (offers.length === 0) {
    return NextResponse.json({ ok: true, items: [], total: 0 });
  }

  const tokenIds = offers.map((o) => o.tokenId);
  const { data, error } = await supabase
    .from("handles")
    .select("token_id, handle, tier, created_at, image_url")
    .in("token_id", tokenIds);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  type HandleRow = {
    token_id: string;
    handle: string;
    tier: string | null;
    created_at: string;
    image_url: string | null;
  };
  const meta = new Map(
    ((data ?? []) as HandleRow[]).map((h) => [
      h.token_id,
      {
        handle: h.handle,
        tier: h.tier ?? null,
        createdAt: h.created_at,
        imageUrl: h.image_url ?? null,
      },
    ])
  );

  const items = offers
    .map((o) => {
      const m = meta.get(o.tokenId);
      if (!m) return null; // listed token we don't have metadata for — skip
      return {
        tokenId: o.tokenId,
        handle: m.handle,
        tier: m.tier,
        createdAt: m.createdAt,
        imageUrl: m.imageUrl,
        priceXec: o.priceXec,
        priceSats: o.priceSats.toString(), // bigint → string for JSON
      };
    })
    .filter(Boolean) as Array<{
      tokenId: string;
      handle: string;
      tier: string | null;
      createdAt: string;
      imageUrl: string | null;
      priceXec: number;
      priceSats: string;
    }>;

  if (sort === "price-desc") items.sort((a, b) => b.priceXec - a.priceXec);
  else if (sort === "new") items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  else if (sort === "old") items.sort((a, b) => (a.createdAt > b.createdAt ? 1 : -1));
  else items.sort((a, b) => a.priceXec - b.priceXec); // price-asc default

  return NextResponse.json({ ok: true, items, total: items.length });
}
