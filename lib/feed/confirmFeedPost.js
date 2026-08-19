import { pollUntil } from '@/lib/ecash/pollUntil'

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
 * Uses the shared pollUntil primitive in its DETACHED form: the returned stop() is
 * ignored — pollUntil ends itself on `done` or the 45s lifetime cap (honest
 * finality is ~2-3s, so a real tx is long recorded by then). A Chronik ws nudge on
 * the pay address fires the check the instant the tx lands, and 429s back off.
 */
export function confirmFeedPostInBackground({
  txid,
  content,
  action,
  parentTxid = null,
  quotedTxid = null,
  forumId = null,
  poll = null,
  preparedAt,
  payAddress,
}) {
  if (!txid || typeof window === 'undefined') return
  pollUntil(
    async () => {
      const res = await fetch('/api/feed/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          content,
          action,
          parentTxid,
          quotedTxid,
          forumId,
          poll,
          since: preparedAt,
          txid,
        }),
      })
      if (res.status === 429) return { backoff: true }
      const data = await res.json().catch(() => ({}))
      // 'posted' = recorded. 'awaiting_payment'/202 = not indexed yet — keep polling.
      return data.status === 'posted' ? { done: true } : undefined
    },
    { onWsAddress: payAddress, maxLifetimeMs: 45_000 },
  )
}
