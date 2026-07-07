// =============================================================================
//  app/api/handle-card/[tokenId]/route.ts
//  GET /api/handle-card/<mint-txid>  -> the Gen 1 ASCII card PNG for that token.
//
//  The card is deterministic from the mint token id (blind reveal), so this
//  route re-renders it on demand. It's the CLIENT-SIDE fallback: the browser
//  can't run the ASCII engine (it reads masks/library.json off disk, Node-only),
//  so the mint/claim reveal and the marketplace grid point an <img> here whenever
//  the best-effort hosted PNG (handles.image_url) isn't set yet. Output is byte-
//  identical to the hosted image (same rasterizeAsciiCard, same seed), so the two
//  paths never disagree. Immutable + long-cached: a token id always maps to one
//  image.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import { rasterizeAsciiCard } from "@/lib/nft-art/hostAsciiCard";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ tokenId: string }> }) {
  const { tokenId } = await params;
  if (!/^[0-9a-fA-F]{64}$/.test(tokenId)) {
    return NextResponse.json({ error: "invalid token id" }, { status: 400 });
  }

  const supabase = createServerSupabase();
  const { data } = await supabase
    .from("handles")
    .select("handle")
    .eq("token_id", tokenId)
    .maybeSingle();
  if (!data?.handle) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const png = rasterizeAsciiCard(data.handle, tokenId);
  return new NextResponse(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
