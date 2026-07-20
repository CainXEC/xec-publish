import { watchPaymentAddress } from '@/lib/ecash/watchPaymentAddress'

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
 * A Chronik ws nudge on the pay address fires the check the instant the tx lands;
 * a 45s safety cap stops a stuck poll (honest finality is ~2-3s).
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
      const res = await fetch('/api/comments/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ postId, content, parentId, since: preparedAt, txid }),
      })
      const data = await res.json().catch(() => ({}))
      if (stopped) return
      if (data.status === 'posted' && data.comment) {
        stop()
        onConfirmed?.(data.comment)
      }
      // 'awaiting_payment'/202 = not indexed yet — keep polling.
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
