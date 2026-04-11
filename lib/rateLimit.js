import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

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
