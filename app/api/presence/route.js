// =============================================================================
//  app/api/presence/route.js — "how many people are on the site right now."
//
//  A Redis sorted-set presence beacon. Every open tab POSTs here on a ~90s
//  heartbeat with a stable per-tab id; we stamp that id with the current time,
//  drop anyone who hasn't pinged inside the window, and return the surviving
//  count. The number rides back in the heartbeat's own response — no extra
//  request, no render-blocking, and no DB. If Redis isn't configured the route
//  is a graceful no-op (count: null → the rail simply hides the number).
//
//  REQUEST BUDGET. This is by far the highest-volume Redis caller on the site —
//  a single always-open tab beats forever — so it is deliberately frugal to stay
//  under a hosted request cap (the free Upstash tier is 500k/month, and the old
//  design blew it from ONE tab). Two levers: a ~45s beat instead of ~25s, and
//  splitting the cheap "mark me present" (one zadd, every beat) from the
//  expensive "count everyone" (prune + ZCARD, only when the client asks — its
//  first beat, then ~every 5 min). Everything still degrades gracefully.
//
//  It counts open tabs/sessions, not unique humans (one person with three tabs
//  reads as three) — the ordinary meaning of "online now."
// =============================================================================

import { NextResponse } from "next/server";
import { getRedis } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEY = "presence:v1";

// The count silently becomes null when Redis is missing OR erroring (e.g. the
// Upstash monthly request cap is hit) — the two are indistinguishable to the
// client, which is why "the number vanished" is hard to diagnose. Log the reason
// so it's visible in the Vercel function logs, throttled per reason (presence is
// high-volume + serverless, so unthrottled it would flood during an outage).
const _lastLog = new Map();
function presenceLog(reason, message) {
  const now = Date.now();
  if (now - (_lastLog.get(reason) ?? 0) < 60_000) return;
  _lastLog.set(reason, now);
  console.error(`[presence] ${message}`);
}
// A tab pings ~every 90s; a 210s window tolerates one missed beat before it's
// counted as gone. KEY_TTL comfortably outlives the client's ~5min count
// cadence so the key survives between refreshes, and still clears itself once
// all traffic stops. (Intervals sized for the free Upstash request cap — the
// count trades a few minutes of staleness for a lot of monthly headroom.)
const WINDOW_MS = 210_000;
const KEY_TTL_S = 600;

// Read the live count: prune anyone outside the window, then ZCARD the rest.
async function liveCount(redis) {
  const now = Date.now();
  await redis.zremrangebyscore(KEY, 0, now - WINDOW_MS);
  return redis.zcard(KEY);
}

export async function POST(req) {
  const redis = getRedis();
  if (!redis) {
    presenceLog(
      "no-redis",
      "Redis not configured — count hidden (set UPSTASH_REDIS_REST_URL/TOKEN or KV_REST_API_URL/TOKEN)",
    );
    return NextResponse.json({ ok: true, count: null });
  }

  let tabId = "";
  // The client asks for the live count only on its first beat and then ~every
  // 2 min; the frequent in-between beats just refresh presence. Splitting the
  // cheap "mark me" from the expensive "count everyone" is what keeps this off
  // the Redis request cap — see the request-budget note at the top of the file.
  let wantCount = true;
  try {
    const body = await req.json();
    tabId = String(body?.id ?? "").slice(0, 64);
    wantCount = body?.count !== false;
  } catch {
    /* no/invalid body — fall through to the validation reject */
  }
  // The tab id is client-generated and opaque; constrain it so a caller can't
  // stuff arbitrary payloads into the set as members. (This shape check is the
  // guard here — a Redis-backed per-IP rate limit was removed: it cost several
  // Redis commands PER beat to protect a purely cosmetic number, and was a
  // major contributor to exhausting the request quota.)
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(tabId)) {
    return NextResponse.json({ ok: true, count: null });
  }

  try {
    const now = Date.now();
    // Every beat: one command to mark this tab present. zadd leaves the key's
    // TTL intact, so a count-beat's expire keeps carrying the whole set.
    await redis.zadd(KEY, { score: now, member: tabId });
    if (!wantCount) return NextResponse.json({ ok: true });
    // Count-beat: prune the departed, refresh the key TTL, and read the count.
    await redis.expire(KEY, KEY_TTL_S);
    return NextResponse.json({ ok: true, count: await liveCount(redis) });
  } catch (e) {
    // Almost always the Upstash monthly request cap (the free tier is 500k/mo);
    // the message says which so the logs distinguish quota from auth/network.
    presenceLog("error", `Redis error — count hidden: ${e?.name}: ${e?.message}`);
    return NextResponse.json({ ok: true, count: null });
  }
}
