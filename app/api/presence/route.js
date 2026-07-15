// =============================================================================
//  app/api/presence/route.js — "how many people are on the site right now."
//
//  A Redis sorted-set presence beacon. Every open tab POSTs here on a ~25s
//  heartbeat with a stable per-tab id; we stamp that id with the current time,
//  drop anyone who hasn't pinged inside the window, and return the surviving
//  count. The number rides back in the heartbeat's own response — no extra
//  request, no render-blocking, and no DB. If Redis isn't configured the route
//  is a graceful no-op (count: null → the rail simply hides the number).
//
//  It counts open tabs/sessions, not unique humans (one person with three tabs
//  reads as three) — the ordinary meaning of "online now."
// =============================================================================

import { NextResponse } from "next/server";
import { getRedis, getClientIp, rateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEY = "presence:v1";
// A tab pings ~every 25s; a 60s window tolerates one missed beat before it's
// counted as gone. KEY_TTL keeps the set from lingering if all traffic stops.
const WINDOW_MS = 60_000;
const KEY_TTL_S = 120;

// Read the live count: prune anyone outside the window, then ZCARD the rest.
async function liveCount(redis) {
  const now = Date.now();
  await redis.zremrangebyscore(KEY, 0, now - WINDOW_MS);
  return redis.zcard(KEY);
}

export async function POST(req) {
  const redis = getRedis();
  if (!redis) return NextResponse.json({ ok: true, count: null });

  // Light per-IP cap so the number can't be trivially spammed upward. A
  // throttled tab still gets a fresh count read (cheap) so its display holds.
  const ip = getClientIp(req);
  const allowed = await rateLimit(ip, 8, 60, "presence");
  if (!allowed) {
    try {
      return NextResponse.json({ ok: true, count: await liveCount(redis) });
    } catch {
      return NextResponse.json({ ok: true, count: null });
    }
  }

  let tabId = "";
  try {
    const body = await req.json();
    tabId = String(body?.id ?? "").slice(0, 64);
  } catch {
    /* no/invalid body — fall through to the validation reject */
  }
  // The tab id is client-generated and opaque; constrain it so a caller can't
  // stuff arbitrary payloads into the set as members.
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(tabId)) {
    return NextResponse.json({ ok: true, count: null });
  }

  try {
    const now = Date.now();
    await redis.zadd(KEY, { score: now, member: tabId });
    await redis.expire(KEY, KEY_TTL_S);
    return NextResponse.json({ ok: true, count: await liveCount(redis) });
  } catch {
    return NextResponse.json({ ok: true, count: null });
  }
}
