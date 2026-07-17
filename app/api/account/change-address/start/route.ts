// =============================================================================
//  app/api/account/change-address/start/route.ts
//  POST -> begin changing the logged-in account's wallet address: issue a
//  challenge payment request (6 XEC, one-time nonce in OP_RETURN) that must
//  be paid FROM THE NEW WALLET. Gated on a challenge-scope session — a weaker
//  pay-minted session must never be able to redirect a creator's earnings.
//  Thin wrapper over startAddressChange() in lib/walletAuth.ts.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { startAddressChange } from "@/lib/walletAuth";
import { getChallengeSession } from "@/lib/session";
import { rateLimit, getClientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  if (!(await rateLimit(ip, 5, 60, "addr-change-start"))) {
    return NextResponse.json({ ok: false, error: "Too many attempts. Try again shortly." }, { status: 429 });
  }

  const claim = await getChallengeSession();
  if (!claim) {
    return NextResponse.json(
      { ok: false, error: "Please log in again (a fresh wallet login) to change your wallet address." },
      { status: 403 },
    );
  }

  const result = await startAddressChange();
  return NextResponse.json(result);
}
