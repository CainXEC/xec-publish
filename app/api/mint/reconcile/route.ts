// =============================================================================
//  app/api/mint/reconcile/route.ts
//  Server-side delivery sweep for handle mints (lib/mintReconcile). Finishes any
//  paid mint whose browser closed before it completed — so a payment that clears
//  always ends in the handle being delivered, without the buyer keeping the tab
//  open. Runs off the existing feed-reconcile cron (which calls runMintReconcile
//  too), and is exposed here for manual / opportunistic triggering.
//
//  Safe for anyone to trigger: it only completes mints that are genuinely
//  paid-on-chain, routed through the same lock-serialized, idempotent,
//  double-mint-safe processor as the live path. Untrusted callers are merely
//  rate-limited so they can't burn Chronik/mint work.
// =============================================================================

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientIp } from "@/lib/rateLimit";
import { runMintReconcile } from "@/lib/mintReconcile";

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  const auth = request.headers.get("authorization") || "";
  const trusted = Boolean(secret) && auth === `Bearer ${secret}`;

  if (!trusted) {
    const ip = getClientIp(request);
    if (!(await rateLimit(ip, 4, 60, "mint-reconcile"))) {
      return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    }
  }

  try {
    const result = await runMintReconcile();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("[mint-reconcile] sweep failed", e);
    return NextResponse.json({ error: "Sweep failed" }, { status: 500 });
  }
}
