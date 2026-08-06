import { pollUntil } from '@/lib/ecash/pollUntil'

/**
 * Fire-and-forget: record an already-broadcast paid comment/reply server-side.
 *
 * The optimistic path shows the comment the instant the pocket broadcasts and
 * dismisses the composer immediately — so the recording can't live inside the
 * (now-gone) composer's poll. This polls POST /api/comments/confirm with the
 * KNOWN txid until the row is inserted, then hands the RECORDED comment back via
 * onConfirmed. Unlike the feed (which threads by txid and can keep its optimistic
 * row as-is), comments thread by database id — so the caller swaps the optimistic
 * row for this confirmed one to pick up the real id, and replies thread correctly.
 *
 * Uses the shared pollUntil primitive detached: the ws nudge fires the check the
 * instant the tx lands, 429s back off, and the 45s lifetime cap ends a stuck poll.
 */
export function confirmCommentInBackground({
  postId,
  content,
  parentId = null,
  txid,
  preparedAt,
  payAddress,
  onConfirmed,
}) {
  if (!txid || typeof window === 'undefined') return
  pollUntil(
    async () => {
      const res = await fetch('/api/comments/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ postId, content, parentId, since: preparedAt, txid }),
      })
      if (res.status === 429) return { backoff: true }
      const data = await res.json().catch(() => ({}))
      if (data.status === 'posted' && data.comment) {
        onConfirmed?.(data.comment)
        return { done: true }
      }
      // 'awaiting_payment'/202 = not indexed yet — keep polling.
      return undefined
    },
    { onWsAddress: payAddress, maxLifetimeMs: 45_000 },
  )
}
