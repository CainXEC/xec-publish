// =============================================================================
//  app/api/cron/herald-weekly/route.ts
//  MONDAY 00:10 UTC trigger for the POW-rewards herald — fires the rewards
//  ANNOUNCEMENT for the just-closed week. The payout runs at Monday 00:00
//  (pow-payout, capped at 2 min); this 10-minute cushion guarantees the week is
//  marked `done` before the herald checks, so it posts the weekly rewardees (the
//  00:00 herald-trigger already posted the day's scoreboard, so on Mondays you
//  get both — the scoreboard at 00:00, the rewards at 00:10).
//
//  Same herald workflow as herald-trigger; the herald decides what to post from
//  its own dedup + the week's paid state. Gated by CRON_SECRET.
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
