import { pollUntil } from '@/lib/ecash/pollUntil'
import { clearPendingForum } from '@/lib/forums/pendingForumCreate'

// Stop chasing a payment that clearly never came, so a never-paid pending entry
// can't retry on every Forums visit for its whole 24h life.
const ABANDON_AFTER_S = 15 * 60

/**
 * Fire-and-forget: finish an interrupted forum creation from a stashed payload
 * (see pendingForumCreate). The confirm route is idempotent — it creates the
 * forum once, then returns the existing one to its owner — so this can safely run
 * after the in-component poll died. Polls until:
 *   - created → clear the pending entry + notify (the forum shows up), or
 *   - a hard error (name taken by someone else / not a handle-holder / bad input)
 *     → it can never succeed, so clear + stop, or
 *   - the pay window is long past with no matching payment → they never paid,
 *     clear + stop.
 */
export function confirmForumInBackground(entry, { onCreated } = {}) {
  if (typeof window === 'undefined' || !entry?.slug) return
  pollUntil(
    async () => {
      const res = await fetch('/api/forums/create/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slug: entry.slug,
          title: entry.title,
          description: entry.description,
          since: entry.preparedAt,
          ...(entry.txid ? { txid: entry.txid } : {}),
        }),
      })
      if (res.status === 429) return { backoff: true }
      const data = await res.json().catch(() => ({}))
      if (data.status === 'created' && data.forum) {
        clearPendingForum(entry.slug)
        onCreated?.(data.forum)
        return { done: true }
      }
      // Will never succeed — forget it.
      if (!res.ok && [400, 403, 409].includes(res.status)) {
        clearPendingForum(entry.slug)
        return { done: true }
      }
      // No matching payment, and the pay window is long gone — they never paid.
      if (
        data.status === 'awaiting_payment' &&
        Date.now() / 1000 - (Number(entry.preparedAt) || 0) > ABANDON_AFTER_S
      ) {
        clearPendingForum(entry.slug)
        return { done: true }
      }
      return undefined
    },
    { onWsAddress: entry.payAddress, maxLifetimeMs: 60_000 },
  )
}
