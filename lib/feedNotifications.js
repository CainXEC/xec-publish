// =============================================================================
//  lib/feedNotifications.js  —  feed-native notifications, keyed by accounts(id)
//
//  The article-side `notifications` table is keyed by authors.id and surfaced on
//  the author-only dashboard. Feed activity targets accounts (often reader-only
//  accounts with no author_id), so it gets its own account-keyed table and its
//  own bell on the feed header. See sql/feed_notifications.sql.
//
//  Writes are best-effort: a notification never blocks or fails the underlying
//  action (the post/reaction/follow is already recorded on-chain). Reads power
//  the header bell via /api/feed/notifications.
// =============================================================================

export const FEED_NOTIF_TYPES = ['reply', 'quote', 'like', 'repost', 'follow', 'offer']

const NOTIF_COLUMNS =
  'id, recipient_account_id, actor_account_id, actor_identity, type, post_txid, read, created_at'

/**
 * Record a single feed notification for `recipientAccountId`. No-op (silently)
 * when the recipient is missing, the recipient is the actor (don't notify your
 * own action), or the type is unknown. Never throws — logs and swallows errors
 * so the caller's primary action is unaffected.
 *
 * @param {*} supabase service-role client
 * @param {{ recipientAccountId: string | null | undefined,
 *           actorAccountId: string | null | undefined,
 *           actorIdentity: string,
 *           type: string,
 *           postTxid?: string | null }} event
 */
export async function recordFeedNotification(
  supabase,
  { recipientAccountId, actorAccountId, actorIdentity, type, postTxid = null },
) {
  if (!recipientAccountId || !actorAccountId) return
  if (recipientAccountId === actorAccountId) return
  if (!FEED_NOTIF_TYPES.includes(type)) return

  try {
    const { error } = await supabase.from('feed_notifications').insert({
      recipient_account_id: recipientAccountId,
      actor_account_id: actorAccountId,
      actor_identity: typeof actorIdentity === 'string' ? actorIdentity : '',
      type,
      post_txid: postTxid,
    })
    if (error) console.error('[feed-notif] insert failed (action still ok)', error.message)
  } catch (e) {
    console.error('[feed-notif] insert threw (action still ok)', e)
  }
}

/**
 * The most recent notifications for one account, newest first, plus the current
 * unread total. Returns { notifications, unreadCount }.
 */
export async function getFeedNotifications(supabase, accountId, { limit = 20, before = null } = {}) {
  if (!accountId) return { notifications: [], unreadCount: 0, nextCursor: null }

  let listQuery = supabase
    .from('feed_notifications')
    .select(NOTIF_COLUMNS)
    .eq('recipient_account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(limit)
  // Keyset pagination: "Load more" pages back through history from the oldest
  // row already shown (its created_at is the cursor). The list is NOT filtered
  // by read status, so read notifications remain reachable — marking the bell
  // read on open never hides older ones.
  if (before) listQuery = listQuery.lt('created_at', before)

  const [{ data, error }, { count, error: countErr }] = await Promise.all([
    listQuery,
    // The unread total only drives the badge, which is a first-page concern —
    // skip the extra count query when paging older notifications.
    before
      ? Promise.resolve({ count: null, error: null })
      : supabase
          .from('feed_notifications')
          .select('id', { count: 'exact', head: true })
          .eq('recipient_account_id', accountId)
          .eq('read', false),
  ])

  if (error) console.error('[feed-notif] list failed', error.message)
  if (countErr) console.error('[feed-notif] count failed', countErr.message)

  // 'offer' rows carry the handle's TOKEN id in post_txid; decorate them with
  // the handle name and the bidder's CURRENT open amount so the bell can say
  // "offered 25,000 XEC for @name". The recipient of these rows IS the
  // holder, so showing the amount here leaks nothing. Read-time lookup: an
  // updated offer shows its latest amount, a withdrawn one falls back to the
  // amountless copy.
  const rows = data ?? []
  const offerRows = rows.filter((n) => n.type === 'offer' && n.post_txid)
  if (offerRows.length > 0) {
    const offerTokenIds = [...new Set(offerRows.map((n) => n.post_txid))]
    try {
      const [{ data: handles }, { data: offers }] = await Promise.all([
        supabase.from('handles').select('token_id, handle').in('token_id', offerTokenIds),
        supabase
          .from('handle_offers')
          .select('token_id, bidder_account_id, amount_sats')
          .in('token_id', offerTokenIds)
          .eq('status', 'open'),
      ])
      const byToken = new Map((handles ?? []).map((h) => [h.token_id, h.handle]))
      const amountByOffer = new Map(
        (offers ?? []).map((o) => [`${o.token_id}:${o.bidder_account_id}`, o.amount_sats]),
      )
      for (const n of offerRows) {
        n.handle = byToken.get(n.post_txid) ?? null
        const sats = amountByOffer.get(`${n.post_txid}:${n.actor_account_id}`)
        n.offerAmountXec = sats == null ? null : sats / 100
      }
    } catch {
      /* best-effort decoration; the bell falls back to generic copy */
    }
  }

  // A full page implies more may exist; the oldest row's timestamp is the next
  // cursor. A short page means we've reached the end.
  const nextCursor = rows.length === limit ? rows[rows.length - 1].created_at : null
  return { notifications: rows, unreadCount: count ?? 0, nextCursor }
}

/**
 * Mark every unread notification for this account as read. Called when the bell
 * dropdown is opened.
 */
export async function markFeedNotificationsRead(supabase, accountId) {
  if (!accountId) return
  const { error } = await supabase
    .from('feed_notifications')
    .update({ read: true })
    .eq('recipient_account_id', accountId)
    .eq('read', false)
  if (error) console.error('[feed-notif] mark-read failed', error.message)
}

/**
 * Delete notifications older than `olderThanDays` (read or unread — anything that
 * old is stale). Keeps the table from growing unbounded. Run from the reconcile
 * cron. Returns the number of rows removed. Never throws.
 */
export async function pruneOldFeedNotifications(supabase, { olderThanDays = 30 } = {}) {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from('feed_notifications')
    .delete()
    .lt('created_at', cutoff)
    .select('id')
  if (error) {
    console.error('[feed-notif] prune failed', error.message)
    return 0
  }
  return data?.length ?? 0
}
