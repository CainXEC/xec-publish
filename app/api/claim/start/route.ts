// =============================================================================
//  app/api/claim/start/route.ts
//  POST { handle, code }  ->  verifies the one-time code, locks the grant, and
//  returns a proof request (send a tiny unique dust tx to prove key control).
//  Thin wrapper over startClaim() in lib/claimGrant.ts.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { startClaim } from "@/lib/claimGrant";
import { rateLimit, getClientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // The one-time claim code is the only thing standing between a caller and a
  // free handle grant, so cap redemption attempts to make brute-forcing codes
  // infeasible.
  const ip = getClientIp(req);
  if (!(await rateLimit(ip, 5, 60, "claim-start"))) {
    return NextResponse.json({ ok: false, error: "Too many attempts. Try again shortly." }, { status: 429 });
  }

  const { handle, code } = await req.json().catch(() => ({}));
  if (!handle || !code) {
    return NextResponse.json({ ok: false, error: "missing handle or code" }, { status: 400 });
  }

  const result = await startClaim({ handle, code });

  // startClaim already returns a discriminated { ok, ... } shape the client reads.
  // On failure it carries a `code` + `error`; on success the proof request fields.
  return NextResponse.json(result);
}
