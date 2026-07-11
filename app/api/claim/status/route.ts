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
import { autoLoginByPayment } from "@/lib/payAutoLogin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const handle = req.nextUrl.searchParams.get("handle");
  const txid = req.nextUrl.searchParams.get("txid") ?? undefined;
  if (!handle) {
    return NextResponse.json({ ok: false, error: "missing handle" }, { status: 400 });
  }

  const result = await pollClaim({ handle, txid });
  // A completed claim doubles as login: the proof payment proved control of the
  // claimer's address, so issue a 'pay' session (same as the mint flow). ONLY on
  // FRESH completion — pollClaim returns address:"" on an already-claimed re-poll,
  // and autoLoginByPayment no-ops on an empty address, so a public
  // /status?handle= poll of an already-claimed handle can never mint a session for
  // someone else (the handle is public; the mintId in the mint flow is not).
  if (result.ok && result.status === "claimed" && result.address) {
    await autoLoginByPayment(req, result.address);
  }
  return NextResponse.json(result);
}
