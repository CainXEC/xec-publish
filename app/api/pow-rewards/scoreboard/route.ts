// GET /api/pow-rewards/scoreboard[?top=N][?window=day|today|week]
// Public leaderboard of Contribution Scores. Windows:
//   • (default)     live top-N of the in-progress week (week-to-date).
//   • window=today  live top-N for the CURRENT UTC day so far — the in-progress
//                   race for tonight's daily prize.
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
    if (window === "today") {
      const now = new Date();
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())); // today 00:00
      // Round the end down to the minute so the bounds-keyed cache actually hits
      // under repeated requests (a live board a minute stale is fine).
      const end = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
      const date = start.toISOString().slice(0, 10);
      const board = await windowScoreboard(start, end, top, {
        window: "day",
        label: date,
        date,
        isoWeek: weekBoundsFor(start).isoWeek,
      });
      return NextResponse.json({ ok: true, live: true, ...board });
    }
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
