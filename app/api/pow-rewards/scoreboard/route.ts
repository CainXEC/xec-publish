// GET /api/pow-rewards/scoreboard[?top=N][?window=day|week]
// Public leaderboard of Contribution Scores. Three windows:
//   • (default)     live top-N of the in-progress week (week-to-date).
//   • window=day    top-N over the most recent COMPLETE UTC day (herald daily).
//   • window=week   top-N over the most recent COMPLETE ISO week (herald weekly).
// Curated read — no sensitive data, just handles + composite scores (public by design).
import { NextRequest, NextResponse } from "next/server";
import { runningScoreboard, windowScoreboard } from "@/lib/powRewards/scoreboard";
import { lastCompleteDay, lastCompleteWeek, weekBoundsFor } from "@/lib/powRewards/isoWeek";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const topParam = Number(req.nextUrl.searchParams.get("top") ?? 10);
  const top = Math.min(Math.max(Number.isFinite(topParam) ? topParam : 10, 1), 50);
  const window = req.nextUrl.searchParams.get("window");
  try {
    if (window === "day") {
      const d = lastCompleteDay();
      const board = await windowScoreboard(d.startUtc, d.endUtc, top, {
        window: "day",
        label: d.date,
        date: d.date,
        isoWeek: weekBoundsFor(d.startUtc).isoWeek,
      });
      return NextResponse.json({ ok: true, ...board });
    }
    if (window === "week") {
      const w = lastCompleteWeek();
      const board = await windowScoreboard(w.startUtc, w.endUtc, top, {
        window: "week",
        label: w.isoWeek,
        isoWeek: w.isoWeek,
      });
      return NextResponse.json({ ok: true, ...board });
    }
    const board = await runningScoreboard(top);
    return NextResponse.json({ ok: true, window: "live", ...board });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
