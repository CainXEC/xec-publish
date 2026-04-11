const requests = new Map()

/**
 * Sliding-window limiter. `routeKey` isolates counters per HTTP route so different
 * endpoints do not share the same request budget for an IP.
 */
export function rateLimit(ip, limit, windowMs, routeKey = 'default') {
  const key = `${routeKey}:${ip}`
  const now = Date.now()
  const windowStart = now - windowMs

  if (!requests.has(key)) {
    requests.set(key, [])
  }

  const timestamps = requests.get(key).filter((t) => t > windowStart)
  timestamps.push(now)
  requests.set(key, timestamps)

  return timestamps.length <= limit
}
