// =============================================================================
//  lib/dispatchHerald.ts
//  Fire the POW-rewards herald (POW_AGENT1) by dispatching its GitHub Actions
//  workflow (herald.yml in the SEPARATE ai-satoshi repo). Shared by the Vercel
//  cron routes that drive the herald — GitHub's own `schedule:` cron is
//  unreliable for a low-activity private repo, so Vercel Cron dispatches it.
//
//  Needs GH_HERALD_DISPATCH_TOKEN: a fine-grained PAT with "Actions: read and
//  write" on CainXEC/ai-satoshi (nothing else). Set it in Vercel env only.
// =============================================================================

import { NextResponse } from "next/server";

const REPO = process.env.HERALD_GH_REPO || "CainXEC/ai-satoshi";
const WORKFLOW = process.env.HERALD_GH_WORKFLOW || "herald.yml";
const REF = process.env.HERALD_GH_REF || "main";

/** POST a workflow_dispatch for the herald and return a JSON NextResponse. */
export async function dispatchHerald(): Promise<NextResponse> {
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

/** CRON_SECRET bearer check — Vercel sends it on cron requests. */
export function cronTrusted(req: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  const auth = req.headers.get("authorization") || "";
  return Boolean(secret) && auth === `Bearer ${secret}`;
}
