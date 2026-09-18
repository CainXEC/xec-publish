// GET /api/pow-rewards/scoreboard[?top=N]
// Public live leaderboard for the in-progress week (top-N Contribution Scores +
// the cutoff to beat + how many others are in the running). Curated read — no
// sensitive data, just handles + composite scores (the board is public by design).
import { NextRequest, NextResponse } from "next/server";
import { runningScoreboard } from "@/lib/powRewards/scoreboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const topParam = Number(req.nextUrl.searchParams.get("top") ?? 10);
  const top = Math.min(Math.max(Number.isFinite(topParam) ? topParam : 10, 1), 50);
  try {
    const board = await runningScoreboard(top);
    return NextResponse.json({ ok: true, ...board });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
