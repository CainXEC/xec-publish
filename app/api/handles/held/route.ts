// =============================================================================
//  app/api/handles/held/route.ts
//  The handles an identity OWNS — for the marketplace's "handles held by @who"
//  scope (the profile's "Make an offer on a handle →" link lands here). Two
//  sources, because ownership can live in two places on-chain:
//    • HELD (unlisted) — the NFT sits in the owner's wallet. heldHandlesForAddress
//      asks Chronik which of our handle NFTs are in that wallet (mirrors the
//      profile carousel).
//    • LISTED — the owner put it up for sale, so the NFT is locked in the Agora
//      escrow covenant, NOT their wallet. heldHandlesForAddress can't see those,
//      so we ALSO pull the active Agora offers whose lister belongs to this
//      account and merge them in. Without this, a user's listed handles vanish
//      from their own gallery.
//
//  GET ?identity=<@handle | handle | ecash address>
//  Returns public-safe card fields only (no account ids / payer addresses). Price
//  is left off here — the client decorates listed cards from its live listings
//  fetch (same as the "all" view), so a card is "listed" wherever an ask exists.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { resolveProfileByIdentifier } from "@/lib/resolveProfile";
import { heldHandlesForAddress } from "@/lib/heldHandles";
import { adminDb } from "@/lib/db";
import { fetchActiveHandleOffers } from "@/lib/agoraMarketplace";
import { chronikBudget } from "@/lib/ecash/chronikBudget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bare = (a: string) => a.replace(/^ecash:/, "").toLowerCase();

type Item = {
  tokenId: string;
  handle: string;
  tier: string | null;
  createdAt: string | null;
  imageUrl: string | null;
};

/** Handles this identity has LISTED on Agora (token in escrow, so not in their
 *  wallet). Matches active offers whose lister address belongs to the holder's
 *  account, then joins metadata from the handles table. Best-effort: any Agora /
 *  DB hiccup just omits listed handles — the held ones still render. */
async function listedHandlesForHolder(
  holderAddress: string,
  excludeTokenIds: Set<string>
): Promise<Item[]> {
  try {
    const supabase = adminDb();

    // The holder's account + all its linked addresses — a listing may have been
    // made from any of them (e.g. after an address change).
    const holderBare = new Set<string>([bare(holderAddress)]);
    const { data: link } = await supabase
      .from("account_addresses")
      .select("account_id")
      .in("address", [bare(holderAddress), `ecash:${bare(holderAddress)}`])
      .limit(1);
    const accountId = (link?.[0]?.account_id as string | undefined) ?? null;
    if (accountId) {
      const { data: addrs } = await supabase
        .from("account_addresses")
        .select("address")
        .eq("account_id", accountId);
      for (const a of (addrs ?? []) as Array<{ address: string }>) holderBare.add(bare(a.address));
    }

    const offers = await chronikBudget(fetchActiveHandleOffers(), 2500, null);
    if (!offers) return [];
    const myTokenIds = offers
      .filter((o) => o.sellerAddress && holderBare.has(bare(o.sellerAddress)))
      .map((o) => o.tokenId)
      .filter((id) => !excludeTokenIds.has(id));
    if (myTokenIds.length === 0) return [];

    const { data: rows } = await supabase
      .from("handles")
      .select("token_id, handle, created_at, image_url")
      .in("token_id", myTokenIds);
    return ((rows ?? []) as Array<{
      token_id: string;
      handle: string;
      created_at: string;
      image_url: string | null;
    }>).map((h) => ({
      tokenId: h.token_id,
      handle: h.handle,
      tier: null,
      createdAt: h.created_at,
      imageUrl: h.image_url,
    }));
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  const raw = (req.nextUrl.searchParams.get("identity") ?? "").trim().replace(/^@/, "");
  if (!raw) {
    return NextResponse.json({ ok: false, error: "missing identity" }, { status: 400 });
  }

  const resolved = await resolveProfileByIdentifier(raw);
  if (!resolved || !resolved.holderAddress) {
    // Unknown identity or a handle nobody currently holds — an empty, valid set.
    return NextResponse.json({ ok: true, items: [], identity: raw, holder: null });
  }

  const held = await heldHandlesForAddress(resolved.holderAddress);
  const heldItems: Item[] = held.map((h) => ({
    tokenId: h.tokenId,
    handle: h.handle,
    tier: null, // client derives the tier from the name
    createdAt: h.createdAt,
    imageUrl: h.imageUrl,
  }));

  // Merge in the handles this owner has LISTED (in Agora escrow, not their wallet).
  const listedItems = await listedHandlesForHolder(
    resolved.holderAddress,
    new Set(heldItems.map((i) => i.tokenId))
  );

  const items = [...heldItems, ...listedItems];

  // `holder` is the resolved display identity (@handle when held, else address),
  // so the gallery header reads correctly even if the caller passed a raw address.
  return NextResponse.json({ ok: true, items, identity: raw, holder: resolved.identity });
}
