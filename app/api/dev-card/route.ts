// =============================================================================
//  app/api/dev-card/route.ts  (DEV ONLY)
//  GET /api/dev-card?handle=<handle>&seed=<anything>
//    -> the Gen 1 ASCII card PNG for that handle, rendered on the fly.
//
//  Lets you eyeball the 3-tier art engine in the browser WITHOUT minting: the
//  tier is derived from the handle length (1–5 = short/kaomoji, 6–10 = mid/scene,
//  11–15 = base/silhouette) and the art is seeded by ?seed (stand-in for the mint
//  txid). Disabled in production so it can never leak a mint-time preview.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { rasterizeAsciiCard } from "@/lib/nft-art/hostAsciiCard";
import { validateHandleSyntax } from "@/lib/handleSkeleton";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "not available" }, { status: 404 });
  }
  const handle = req.nextUrl.searchParams.get("handle") ?? "";
  const seed = req.nextUrl.searchParams.get("seed") || `dev-${handle}`;
  const err = validateHandleSyntax(handle);
  if (err) return NextResponse.json({ error: err }, { status: 400 });

  // rasterizeAsciiCard seeds by a "token id" — any string works for a preview.
  const png = rasterizeAsciiCard(handle, seed);
  return new NextResponse(new Uint8Array(png), {
    headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
  });
}
