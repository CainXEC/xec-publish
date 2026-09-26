// =============================================================================
//  app/api/cron/patron-daily-reward/route.ts
//  DAILY 00:01 UTC trigger for the POW daily prize: dispatches the patron's
//  daily-reward.yml workflow (ai-satoshi), which tips the just-completed UTC
//  day's #1 Contribution-Score account from the PATRON wallet. Runs just after
//  the day closes — the completed-day board is frozen the instant the clock
//  passes 00:00, and the scorer reads 0-conf records, so no buffer is needed.
//
//  The workflow itself no-ops on Monday (Sunday's #1 is a weekly prize) and does
//  nothing unless DAILY_REWARD_ENABLED=1 and the patron wallet is funded — this
//  cron only pokes it; all the money logic + safety live in src/dailyReward.ts.
//
//  Gated by CRON_SECRET. Dispatch details + env in lib/dispatchHerald.ts.
// =============================================================================

import { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { dispatchWorkflow, cronTrusted } from "@/lib/dispatchHerald";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  if (!cronTrusted(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return dispatchWorkflow(process.env.PATRON_REWARD_GH_WORKFLOW || "daily-reward.yml");
}
