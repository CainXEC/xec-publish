// =============================================================================
//  app/api/cron/herald-trigger/route.ts
//  Daily 00:00 UTC trigger for the POW-rewards herald (POW_AGENT1). The herald
//  lives in the SEPARATE ai-satoshi repo and posts via a GitHub Actions workflow
//  (herald.yml). GitHub's own `schedule:` cron is unreliable for a low-activity
//  private repo — it silently stops firing after the repo goes quiet — which is
//  exactly why the daily scoreboard/announcement went missing. Vercel Cron is
//  dependable, so we drive the herald from here: this route dispatches the
//  workflow through the GitHub REST API (workflow_dispatch).
//
//  Ordering on Mondays: the weekly reward payout is its own Vercel cron at
//  Monday 00:00 (pow-payout) and completes in seconds. GitHub Actions needs
//  ~1 min to cold-start (checkout + npm ci + selftest) before the herald reads
//  the weekly status, so the payout is always `done` first and the herald posts
//  that week's rewardees — the same assumption the herald code already makes.
//
//  Auth: gated by CRON_SECRET (Vercel sends it as the Bearer on cron requests),
//  so only the scheduler can fire it — same guard as pow-payout.
//  Needs GH_HERALD_DISPATCH_TOKEN: a fine-grained PAT with "Actions: read and
//  write" on CainXEC/ai-satoshi (nothing else). Set it in Vercel env only.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const REPO = process.env.HERALD_GH_REPO || "CainXEC/ai-satoshi";
const WORKFLOW = process.env.HERALD_GH_WORKFLOW || "herald.yml";
const REF = process.env.HERALD_GH_REF || "main";

function trusted(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  const auth = req.headers.get("authorization") || "";
  return Boolean(secret) && auth === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!trusted(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const token = process.env.GH_HERALD_DISPATCH_TOKEN?.trim();
  if (!token) {
    return NextResponse.json(
      { ok: false, error: "GH_HERALD_DISPATCH_TOKEN not set" },
      { status: 500 },
    );
  }

  const url = `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "pow-herald-cron",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: REF }),
    });
    // GitHub returns 204 No Content on a successful dispatch.
    if (res.status === 204) {
      return NextResponse.json({ ok: true, dispatched: `${REPO}:${WORKFLOW}@${REF}` });
    }
    const detail = await res.text();
    return NextResponse.json(
      { ok: false, status: res.status, error: detail.slice(0, 500) },
      { status: 502 },
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "dispatch failed" },
      { status: 500 },
    );
  }
}
