import { pollUntil } from '@/lib/ecash/pollUntil'

/**
 * Fire-and-forget: record an already-broadcast emoji reaction server-side.
 *
 * The instant Pocket-reaction path (useReactionPayment) bumps the pill and
 * unblocks the moment the tx is signed, so it can't keep the recording inside a
 * pending confirm poll — you may have reacted again by then. This polls
 * {endpointBase}/confirm with the KNOWN txid (or scans by pay address when a
 * fallback left none) until the feed_events row lands, then stops. Each call is
 * independent, so reacting again right away never cuts off a prior reaction's
 * recording. Mirrors confirmFeedPostInBackground.
 */
export function confirmReactionInBackground({
  endpointBase = '/api/feed/react',
  txid = null,
  action,
  targetTxid,
  emoji = null,
  preparedAt,
  payAddress,
}) {
  if (typeof window === 'undefined' || !targetTxid) return
  pollUntil(
    async () => {
      const res = await fetch(`${endpointBase}/confirm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action,
          targetTxid,
          since: preparedAt,
          ...(txid ? { txid } : {}),
          ...(emoji ? { emoji } : {}),
        }),
      })
      if (res.status === 429) return { backoff: true }
      const data = await res.json().catch(() => ({}))
      return data.status === 'reacted' ? { done: true } : undefined
    },
    { onWsAddress: payAddress, maxLifetimeMs: 45_000 },
  )
}
