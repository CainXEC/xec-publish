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
export async function getFeedNotifications(supabase, accountId, { limit = 20 } = {}) {
  if (!accountId) return { notifications: [], unreadCount: 0 }

  const [{ data, error }, { count, error: countErr }] = await Promise.all([
    supabase
      .from('feed_notifications')
      .select(NOTIF_COLUMNS)
      .eq('recipient_account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(limit),
    supabase
      .from('feed_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_account_id', accountId)
      .eq('read', false),
  ])

  if (error) console.error('[feed-notif] list failed', error.message)
  if (countErr) console.error('[feed-notif] count failed', countErr.message)

  // 'offer' rows carry the handle's TOKEN id in post_txid; decorate them with
  // the handle name so the bell can say "made an offer on @name" without a
  // client-side join.
  const rows = data ?? []
  const offerTokenIds = [
    ...new Set(rows.filter((n) => n.type === 'offer' && n.post_txid).map((n) => n.post_txid)),
  ]
  if (offerTokenIds.length > 0) {
    try {
      const { data: handles } = await supabase
        .from('handles')
        .select('token_id, handle')
        .in('token_id', offerTokenIds)
      const byToken = new Map((handles ?? []).map((h) => [h.token_id, h.handle]))
      for (const n of rows) {
        if (n.type === 'offer' && n.post_txid) n.handle = byToken.get(n.post_txid) ?? null
      }
    } catch {
      /* best-effort decoration; the bell falls back to generic copy */
    }
  }

  return { notifications: rows, unreadCount: count ?? 0 }
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
