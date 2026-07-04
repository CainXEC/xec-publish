// =============================================================================
//  app/api/claim/status/route.ts
//  GET ?handle=...            -> auto-detect the proof tx, then mint+bind
//  GET ?handle=...&txid=...   -> verify a specific tx (manual "I've paid" path)
//
//  The browser polls this while awaiting the proof. Thin wrapper over
//  pollClaim() in lib/claimGrant.ts, which is serialized by the global mint_lock
//  and handles mint -> bind (accounts.author_id) -> flip to claimed.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { pollClaim } from "@/lib/claimGrant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const handle = req.nextUrl.searchParams.get("handle");
  const txid = req.nextUrl.searchParams.get("txid") ?? undefined;
  if (!handle) {
    return NextResponse.json({ ok: false, error: "missing handle" }, { status: 400 });
  }

  const result = await pollClaim({ handle, txid });
  return NextResponse.json(result);
}
