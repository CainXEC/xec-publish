// GET /api/pow-rewards/score
// The LOGGED-IN viewer's own week-to-date standing (the self-serve "why you got
// POW" / "how am I doing" card). Auth required — a user only sees their own score.
import { NextResponse } from "next/server";
import { getAuthedAccount } from "@/lib/authHelpers";
import { accountScoreLookup } from "@/lib/powRewards/scoreboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const acct = await getAuthedAccount();
  if (!acct) return NextResponse.json({ ok: false, error: "not authenticated" }, { status: 401 });
  try {
    const view = await accountScoreLookup(acct.accountId);
    return NextResponse.json({ ok: true, ...view });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
