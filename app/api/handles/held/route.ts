// =============================================================================
//  app/api/handles/held/route.ts
//  The handles an identity CURRENTLY HOLDS on-chain — for the marketplace's
//  "handles held by @who" scope (the profile's "Make an offer on a handle →"
//  link lands here). Holdership is on-chain, so this mirrors the profile handle
//  carousel exactly: resolve the identity to its holder address, then ask
//  Chronik which of our handle NFTs sit in that wallet.
//
//  GET ?identity=<@handle | handle | ecash address>
//  Returns public-safe card fields only (no account ids / payer addresses).
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { resolveProfileByIdentifier } from "@/lib/resolveProfile";
import { heldHandlesForAddress } from "@/lib/heldHandles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  const items = held.map((h) => ({
    tokenId: h.tokenId,
    handle: h.handle,
    tier: null as string | null, // client derives the tier from the name
    createdAt: h.createdAt,
    imageUrl: h.imageUrl,
  }));

  // `holder` is the resolved display identity (@handle when held, else address),
  // so the gallery header reads correctly even if the caller passed a raw address.
  return NextResponse.json({ ok: true, items, identity: raw, holder: resolved.identity });
}
