// =============================================================================
//  app/api/auth/status/route.ts
//  GET -> poll for the login payment. On success verifyAuth() has ALREADY set
//  the session cookie (server-side), so this just relays the result and the
//  browser is now authenticated. Rate-limited per IP (accommodates ~2.5s poll).
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/walletAuth";
import { rateLimit, getClientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  if (!(await rateLimit(ip, 40, 60, "auth-status"))) {
    return NextResponse.json({ ok: false, status: "error", error: "Too many requests." }, { status: 429 });
  }

  const result = await verifyAuth();
  return NextResponse.json(result);
}
