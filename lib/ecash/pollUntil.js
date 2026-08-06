import { watchPaymentAddress } from '@/lib/ecash/watchPaymentAddress'

// =============================================================================
//  pollUntil — the ONE payment-confirmation poll primitive.
//
//  Every pay flow (feed post/reply/quote, reactions, comments, unlocks, mints,
//  claims, login, address change) waits for an on-chain payment the same way:
//  poll a "did it land yet?" endpoint on an interval, nudged the instant a
//  Chronik websocket sees the tx, until the server says done. This folds that
//  boilerplate — the interval, the ws subscription + teardown, the stopped
//  latch, the 429 backoff, the optional lifetime cap — into one function so a
//  stuck poll can't hammer a rate-limited route (which would 429 the user's
//  OTHER actions) and every flow behaves consistently.
//
//  It deliberately knows NOTHING about success payloads. `check` owns all the
//  per-flow logic (which status means done, interim "finalizing" states, HTTP
//  hard-stops, settle-once latches, setting notices/navigating) and signals the
//  loop with a tiny result:
//    { done: true }     -> stop (success, or a caller-decided hard stop)
//    { backoff: true }  -> the server throttled us (429) — grow the delay
//    undefined / else   -> keep polling at the base cadence
//  A throw inside `check` is swallowed (a transport blip) and polling continues.
//
//  Returns stop(). In a useEffect: `const stop = pollUntil(...); return stop`.
//  Detached / fire-and-forget (survives an unmount, e.g. confirmFeedPost): call
//  it and ignore the handle — a lifetime cap (or a `done` from check) ends it.
// =============================================================================

/**
 * @param {(wsTxid?: string) => ({done?: boolean, backoff?: boolean} | void) | Promise<...>} check
 * @param {object} [opts]
 * @param {number} [opts.intervalMs=1200]      base cadence between checks
 * @param {number} [opts.maxDelayMs=8000]      backoff ceiling; set <= intervalMs to disable backoff
 * @param {number|null} [opts.maxLifetimeMs=null]  stop after this long (omit = no cap; rely on unmount/done)
 * @param {string|(()=>string|null)|null} [opts.onWsAddress=null]  address to watch; a tx touching it nudges an immediate check
 * @param {boolean} [opts.wsThreadsTxid=false] pass the ws-detected txid into check() (single-tx verify) vs. call bare
 * @param {(()=>void)|null} [opts.onLifetimeExpired=null]  called once if the lifetime cap hits before done
 * @param {boolean} [opts.immediate=true]      run the first check right away vs. after one interval
 * @returns {() => void} stop
 */
export function pollUntil(
  check,
  {
    intervalMs = 1200,
    maxDelayMs = 8000,
    maxLifetimeMs = null,
    onWsAddress = null,
    wsThreadsTxid = false,
    onLifetimeExpired = null,
    immediate = true,
  } = {},
) {
  if (typeof window === 'undefined') return () => {}
  let stopped = false
  let timer = null
  let unwatch = null
  const startedAt = Date.now()
  let delay = intervalMs

  const stop = () => {
    if (stopped) return
    stopped = true
    if (timer) clearTimeout(timer)
    try {
      unwatch?.()
    } catch {
      /* ignore */
    }
  }

  // One check pass. Runs both from the interval loop AND (off-timer) from the ws
  // nudge — either can be the one that lands `done`.
  const runCheck = async (wsTxid) => {
    if (stopped) return
    try {
      const r = await check(wsThreadsTxid ? wsTxid : undefined)
      if (stopped) return
      if (r && r.done) {
        stop()
        return
      }
      delay =
        r && r.backoff && maxDelayMs > intervalMs
          ? Math.min(delay * 2, maxDelayMs)
          : intervalMs
    } catch {
      /* transport blip — keep polling */
    }
  }

  const loop = async () => {
    if (stopped) return
    if (maxLifetimeMs != null && Date.now() - startedAt > maxLifetimeMs) {
      stop()
      try {
        onLifetimeExpired?.()
      } catch {
        /* ignore */
      }
      return
    }
    await runCheck()
    if (!stopped) timer = setTimeout(loop, delay)
  }

  const addr = typeof onWsAddress === 'function' ? onWsAddress() : onWsAddress
  if (addr) {
    unwatch = watchPaymentAddress(
      addr,
      (txid) => {
        if (!stopped) void runCheck(txid)
      },
      () => {
        if (!stopped) void runCheck()
      },
    )
  }

  if (immediate) void loop()
  else timer = setTimeout(loop, delay)

  return stop
}
