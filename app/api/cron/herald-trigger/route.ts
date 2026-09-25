// =============================================================================
//  app/api/cron/herald-trigger/route.ts
//  DAILY 00:00 UTC trigger for the POW-rewards herald (POW_AGENT1). Posts the
//  live Contribution-Score scoreboard. On the SAME 00:00 tick Monday the payout
//  cron runs; the herald won't see it paid yet, so it just posts the scoreboard —
//  the Monday rewards ANNOUNCEMENT is a separate 00:10 trigger (herald-weekly)
//  once the payout has finished. The herald posts scoreboard and weekly
//  independently, so nothing is skipped.
//
//  Gated by CRON_SECRET (Vercel sends it as the Bearer on cron requests).
//  Dispatch details + env in lib/dispatchHerald.ts.
// =============================================================================

import { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { dispatchHerald, cronTrusted } from "@/lib/dispatchHerald";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  if (!cronTrusted(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return dispatchHerald();
}
