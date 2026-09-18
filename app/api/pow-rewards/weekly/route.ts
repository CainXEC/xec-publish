// GET /api/pow-rewards/weekly[?week=YYYY-Www]
// A finalized week's aggregate (total POW + recipient count) and top rewardees —
// what the herald's weekly announcement reads. Defaults to the last complete week.
import { NextRequest, NextResponse } from "next/server";
import { weeklySummary } from "@/lib/powRewards/scoreboard";
import { lastCompleteWeek } from "@/lib/powRewards/isoWeek";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const week = req.nextUrl.searchParams.get("week") || lastCompleteWeek().isoWeek;
  const topParam = Number(req.nextUrl.searchParams.get("top") ?? 10);
  const top = Math.min(Math.max(Number.isFinite(topParam) ? topParam : 10, 1), 50);
  try {
    const summary = await weeklySummary(week, top);
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
