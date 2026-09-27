// POST /api/faucet/claim — claim the new-user welcome gift (XEC + POW) for the
// signed-in account. All eligibility + anti-farming + the send live in
// lib/faucet.ts; this adds auth and an IP rate limit.
import { NextRequest, NextResponse } from "next/server";
import { getAuthedAccount } from "@/lib/authHelpers";
import { claimFaucet } from "@/lib/faucet";
import { rateLimit, getClientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  if (!(await rateLimit(ip, 5, 60, "faucet-claim"))) {
    return NextResponse.json({ ok: false, error: "Too many requests — slow down." }, { status: 429 });
  }
  const acct = await getAuthedAccount();
  if (!acct) return NextResponse.json({ ok: false, state: "signedout", error: "Log in first." }, { status: 401 });
  try {
    const result = await claimFaucet({ accountId: acct.accountId }, ip ?? null);
    return NextResponse.json(result);
  } catch (e) {
    console.error("[faucet] claim error", e);
    return NextResponse.json({ ok: false, error: "Something went wrong — please try again." }, { status: 500 });
  }
}
