import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { ipAddress } from '@vercel/functions'

/**
 * Resolve the real client IP for rate-limit keying. Vercel's ipAddress() reads
 * the platform's trusted forwarding header (immune to a client spoofing
 * x-forwarded-for). Falls back to the raw header + "unknown" for local/dev
 * where the helper returns undefined, so rate limits never key every caller
 * to the same bucket by accident.
 */
export function getClientIp(req) {
  try {
    const ip = ipAddress(req)
    if (ip) return ip
  } catch {
    // not on Vercel (local/test) — fall through to the header
  }
  return req?.headers?.get?.('x-forwarded-for') || 'unknown'
}

/** Lazy init so missing env in tests/local does not throw at import time. */
let redisClient
function getRedis() {
  if (redisClient === undefined) {
    try {
      redisClient = Redis.fromEnv()
    } catch {
      redisClient = null
    }
  }
  return redisClient
}

const limiters = new Map()

export function getRateLimiter(limit, windowSecs) {
  const key = `${limit}-${windowSecs}`
  if (!limiters.has(key)) {
    const redis = getRedis()
    if (!redis) return null
    limiters.set(
      key,
      new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(limit, `${windowSecs} s`),
      }),
    )
  }
  return limiters.get(key)
}

/**
 * @param {string} routeKey - prefixes the id so routes with the same limit/window stay independent.
 */
export async function rateLimit(ip, limit, windowSecs, routeKey = 'default') {
  try {
    const limiter = getRateLimiter(limit, windowSecs)
    if (!limiter) return true
    const { success } = await limiter.limit(`${routeKey}:${ip}`)
    return success
  } catch {
    return true
  }
}
