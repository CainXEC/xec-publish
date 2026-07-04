// =============================================================================
//  app/api/auth/start/route.ts
//  POST -> issue a login challenge: a fixed 5.5 XEC payment request carrying a
//  one-time nonce in OP_RETURN. Rate-limited per IP (login-starts are rare).
//  Thin wrapper over startAuth() in lib/walletAuth.ts.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { startAuth } from "@/lib/walletAuth";
import { rateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for") || "unknown";
  if (!(await rateLimit(ip, 5, 60, "auth-start"))) {
    return NextResponse.json({ ok: false, error: "Too many login attempts. Try again shortly." }, { status: 429 });
  }

  const result = await startAuth();
  return NextResponse.json(result);
}
