import { watchPaymentAddress } from '@/lib/ecash/watchPaymentAddress'

/**
 * Fire-and-forget: record an already-broadcast feed post/reply/quote server-side.
 *
 * The optimistic compose path shows the post the instant the pocket broadcasts and
 * dismisses the composer immediately — so the recording can't live inside the
 * (now-gone) composer's poll. This polls POST /api/feed/confirm with the KNOWN txid
 * until the row is inserted, then stops. The result is discarded (the post is
 * already on screen); this just makes it durable. Each call is independent, so
 * posting again right away never cuts off a prior post's recording.
 *
 * A Chronik ws nudge on the pay address fires the check the instant the tx lands;
 * a 45s safety cap stops a stuck poll (Honest finality is ~2-3s, so a real tx is
 * long recorded by then).
 */
export function confirmFeedPostInBackground({
  txid,
  content,
  action,
  parentTxid = null,
  quotedTxid = null,
  poll = null,
  preparedAt,
  payAddress,
}) {
  if (!txid || typeof window === 'undefined') return
  let stopped = false
  let id = null
  let unwatch = null
  let timeout = null

  const stop = () => {
    if (stopped) return
    stopped = true
    if (id) clearInterval(id)
    if (timeout) clearTimeout(timeout)
    try {
      unwatch?.()
    } catch {
      /* ignore */
    }
  }

  const check = async () => {
    if (stopped) return
    try {
      const res = await fetch('/api/feed/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          content,
          action,
          parentTxid,
          quotedTxid,
          poll,
          since: preparedAt,
          txid,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (stopped) return
      // 'posted' = recorded. 'awaiting_payment'/202 = not indexed yet — keep polling.
      if (data.status === 'posted') stop()
    } catch {
      /* transport blip — keep polling */
    }
  }

  id = setInterval(check, 1200)
  if (payAddress) {
    unwatch = watchPaymentAddress(
      payAddress,
      () => void check(),
      () => void check(),
    )
  }
  timeout = setTimeout(stop, 45_000)
  void check()
}
