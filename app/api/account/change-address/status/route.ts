// =============================================================================
//  app/api/account/change-address/status/route.ts
//  GET -> poll for the new wallet's challenge payment. On success
//  verifyAddressChange() has ALREADY swapped the account's addresses (one
//  transaction) and re-stamped the session cookie for the new address — this
//  just relays the result. Challenge-scope session required on every poll so a
//  session downgraded/expired mid-flow can't complete the swap.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { verifyAddressChange } from "@/lib/walletAuth";
import { getChallengeSession } from "@/lib/session";
import { rateLimit, getClientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  if (!(await rateLimit(ip, 40, 60, "addr-change-status"))) {
    return NextResponse.json({ ok: false, status: "error", error: "Too many requests." }, { status: 429 });
  }

  const claim = await getChallengeSession();
  if (!claim) {
    return NextResponse.json(
      { ok: false, status: "error", error: "Please log in again (a fresh wallet login) to change your wallet address." },
      { status: 403 },
    );
  }

  const result = await verifyAddressChange(claim);
  return NextResponse.json(result);
}
