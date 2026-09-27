// GET /api/faucet/status — where the signed-in viewer stands with the new-user
// welcome faucet (eligible / claimed / capped / ineligible / …), plus the gift
// amounts and the next 00:00 UTC reset. Read-only; see lib/faucet.ts.
import { NextRequest, NextResponse } from "next/server";
import { getAuthedAccount } from "@/lib/authHelpers";
import { faucetStatus } from "@/lib/faucet";
import { rateLimit, getClientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await rateLimit(getClientIp(req), 60, 60, "faucet-status"))) {
    return NextResponse.json({ ok: false, error: "Too many requests" }, { status: 429 });
  }
  try {
    const acct = await getAuthedAccount();
    const status = await faucetStatus(acct ? { accountId: acct.accountId } : null);
    return NextResponse.json({ ok: true, ...status });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
