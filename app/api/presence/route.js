// =============================================================================
//  app/api/presence/route.js — "how many people are on the site right now."
//
//  A Redis sorted-set presence beacon. Every open tab POSTs here on a ~150s
//  heartbeat with a stable per-tab id; we stamp that id with the current time,
//  drop anyone who hasn't pinged inside the window, and return the surviving
//  count. The number rides back in the heartbeat's own response — no extra
//  request, no render-blocking, and no DB. If Redis isn't configured the route
//  is a graceful no-op (count: null → the rail simply hides the number).
//
//  REQUEST BUDGET. This is by far the highest-volume Redis caller on the site, so
//  it is deliberately frugal to stay under a hosted request cap (free Upstash is
//  500k/month, and an early design blew it from ONE tab). Three levers:
//    1. a ~150s beat, so the unavoidable per-tab "mark me present" (one zadd) is
//       infrequent;
//    2. the client asks for the COUNT only on its first beat then ~every 15 min
//       (the beats between are cheap mark-only refreshes);
//    3. the count itself is a GLOBAL number, so the expensive prune + ZCARD is
//       cached in Redis and recomputed at most ~once/45s across ALL tabs, users
//       and instances — a count-beat is otherwise a single cached GET.
//  So the expensive part no longer scales with concurrent readers. Everything
//  still degrades gracefully (any miss → count:null → the rail hides the number).
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
// A tab pings ~every 150s; a 360s window tolerates one missed beat before it's
// counted as gone. (Intervals sized for the free Upstash request cap — the count
// trades a few minutes of staleness for a lot of monthly headroom.)
const WINDOW_MS = 360_000;
// The presence set self-clears once all traffic stops; TTL must outlive the
// client's count cadence (COUNT_EVERY_MS ~15 min) so the set survives between the
// count-beats that refresh it — the recompute below re-arms it.
const KEY_TTL_S = 1_200;

// The count is a GLOBAL number (identical for everyone), so the expensive
// prune+ZCARD is cached in Redis and recomputed at most once per COUNT_CACHE_S
// across ALL tabs, users and serverless instances. THIS is the main lever that
// keeps a growing concurrent-reader count off the Upstash request cap: a
// count-beat is now a cheap GET on the hot path instead of a prune + ZCARD.
const COUNT_KEY = "presence:count:v1";
const COUNT_CACHE_S = 45;

// The live count, served from the short-lived cache when warm. On a miss (at most
// ~once/COUNT_CACHE_S globally) it prunes stale tabs, ZCARDs the rest, caches the
// number, and re-arms the presence key's TTL — the natural, frequent-enough place
// to keep the set alive.
async function liveCount(redis) {
  const cached = await redis.get(COUNT_KEY);
  if (cached != null) {
    const n = Number(cached);
    if (Number.isFinite(n)) return n;
  }
  const now = Date.now();
  await redis.zremrangebyscore(KEY, 0, now - WINDOW_MS);
  const n = await redis.zcard(KEY);
  await redis.set(COUNT_KEY, n, { ex: COUNT_CACHE_S });
  await redis.expire(KEY, KEY_TTL_S);
  return n;
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
    // Every beat: one command to mark this tab present.
    await redis.zadd(KEY, { score: now, member: tabId });
    if (!wantCount) return NextResponse.json({ ok: true });
    // Count-beat: usually just a cached GET (liveCount); the prune + ZCARD + TTL
    // re-arm only run on a cache miss (~once/COUNT_CACHE_S globally).
    return NextResponse.json({ ok: true, count: await liveCount(redis) });
  } catch (e) {
    // Almost always the Upstash monthly request cap (the free tier is 500k/mo);
    // the message says which so the logs distinguish quota from auth/network.
    presenceLog("error", `Redis error — count hidden: ${e?.name}: ${e?.message}`);
    return NextResponse.json({ ok: true, count: null });
  }
}
