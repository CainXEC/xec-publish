// =============================================================================
//  lib/feedNotifications.js  —  the notification store, keyed by accounts(id)
//
//  This is the SINGLE notification system. It's keyed by accounts(id) (not
//  authors.id) so it represents everyone — reader-only accounts and authors
//  alike — and powers one bell, shown in the shared header (FeedTopbar) on every
//  page including the dashboard. The old author-keyed `notifications` table is
//  retired; article-side events (e.g. a "follow author" from an article page)
//  now record here too, via /api/feed/follow. See sql/feed_notifications.sql.
//
//  Writes are best-effort: a notification never blocks or fails the underlying
//  action (the post/reaction/follow is already recorded on-chain). Reads power
//  the header bell via /api/feed/notifications.
// =============================================================================

import { displayHandlesByAccountId } from '@/lib/authorDisplayHandles'
import { accountIdForAuthorId } from '@/lib/accountAuthorLink'

// Feed-social types carry a feed post txid (or, for 'offer', a handle token id)
// in post_txid. Article types carry the article's post id there instead, and the
// bell resolves it to a /posts/<slug> link at read time (see getFeedNotifications).
// 'comment_like' (someone liked YOUR comment) is article-linked too — post_txid
// is the article's post id, and the bell appends #comments.
export const ARTICLE_NOTIF_TYPES = ['unlock', 'comment', 'comment_like']
export const FEED_NOTIF_TYPES = [
  'reply',
  'quote',
  'like',
  'repost',
  'follow',
  'offer',
  ...ARTICLE_NOTIF_TYPES,
]

/**
 * Resolve an ecash address to the account that owns it, plus a display byline.
 * Addresses are stored prefixed + lowercase (see change_primary_address.sql), so
 * we match both bare and `ecash:`-prefixed forms. Returns { accountId, identity }
 * or null when no account claims the address (a stray wallet that never logged in).
 */
export async function resolveAccountByAddress(supabase, address) {
  const bare = String(address ?? '')
    .replace(/^ecash:/, '')
    .toLowerCase()
  if (!bare) return null
  const { data: rows } = await supabase
    .from('account_addresses')
    .select('account_id')
    .in('address', [bare, `ecash:${bare}`])
    .limit(1)
  const accountId = rows?.[0]?.account_id
  if (!accountId) return null
  const { data: acct } = await supabase
    .from('accounts')
    .select('display_handle')
    .eq('id', accountId)
    .maybeSingle()
  if (acct?.display_handle) return { accountId, identity: `@${acct.display_handle}` }
  // No handle: show the account's PRIMARY wallet address, NOT the address passed
  // in — the payer can be a linked non-primary wallet (the Pocket), and a byline
  // must never surface the hot pocket key instead of the account's real primary.
  const { data: primary } = await supabase
    .from('account_addresses')
    .select('address')
    .eq('account_id', accountId)
    .eq('is_primary', true)
    .limit(1)
    .maybeSingle()
  const primaryBare = String(primary?.address ?? bare).replace(/^ecash:/, '').toLowerCase()
  return { accountId, identity: `ecash:${primaryBare}` }
}

/**
 * Record an article-side notification (an unlock or a comment) for the post's
 * author. Best-effort — never throws, never blocks the unlock/comment that
 * already happened. Resolves the recipient (the post's author account) and, when
 * only an address is known, the actor's account. post_txid carries the article's
 * post id so the bell can resolve its slug/title at read time.
 *
 * @param {*} supabase service-role client
 * @param {{ postId: string, type: 'unlock' | 'comment',
 *           actorAccountId?: string | null, actorIdentity?: string | null,
 *           actorAddress?: string | null }} event
 */
export async function recordArticleNotification(
  supabase,
  { postId, type, actorAccountId = null, actorIdentity = null, actorAddress = null, amountSats = null },
) {
  if (!postId || !ARTICLE_NOTIF_TYPES.includes(type)) return
  try {
    // Recipient = the post's author, resolved to their account.
    const { data: post } = await supabase
      .from('posts')
      .select('author_id')
      .eq('id', postId)
      .maybeSingle()
    if (!post?.author_id) return
    const recipientId = await accountIdForAuthorId(supabase, post.author_id)
    if (!recipientId) return

    // Actor: prefer an explicit account (a logged-in actor); otherwise resolve
    // the proven address to its account. No account => can't attribute => skip.
    let acctId = actorAccountId
    let identity = actorIdentity
    if (!acctId && actorAddress) {
      const resolved = await resolveAccountByAddress(supabase, actorAddress)
      if (resolved) {
        acctId = resolved.accountId
        identity = identity || resolved.identity
      }
    }
    if (!acctId) return

    await recordFeedNotification(supabase, {
      recipientAccountId: recipientId,
      actorAccountId: acctId,
      actorIdentity: identity || '',
      type,
      postTxid: postId, // the article's post id; linkified at read time
      amountSats, // gross paid (unlock price / comment cost); bell shows the net
    })
  } catch (e) {
    console.error('[feed-notif] article notif threw (action still ok)', e)
  }
}

const NOTIF_COLUMNS =
  'id, recipient_account_id, actor_account_id, actor_identity, type, post_txid, amount_sats, read, created_at'

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
 *           postTxid?: string | null,
 *           amountSats?: number | null }} event
 */
export async function recordFeedNotification(
  supabase,
  { recipientAccountId, actorAccountId, actorIdentity, type, postTxid = null, amountSats = null },
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
      // Sats paid to the recipient by this action — like, reply, repost, and
      // comment_like all pay the post/comment author. Null for types with no
      // payment to the recipient (follow, quote, etc.); the bell renders the
      // plain verb when it's absent.
      amount_sats: Number.isFinite(amountSats) ? amountSats : null,
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

  // Article rows (unlock / comment) carry the article's post id in post_txid.
  // Resolve it to the article's link + title so the bell can say "unlocked
  // <Title>" and open /posts/<slug> (legacy posts live at /<slug>).
  const articleRows = rows.filter(
    (n) => ARTICLE_NOTIF_TYPES.includes(n.type) && n.post_txid,
  )
  if (articleRows.length > 0) {
    const postIds = [...new Set(articleRows.map((n) => n.post_txid))]
    try {
      const { data: posts } = await supabase
        .from('posts')
        .select('id, slug, title, legacy')
        .in('id', postIds)
      const byId = new Map((posts ?? []).map((p) => [p.id, p]))
      for (const n of articleRows) {
        const p = byId.get(n.post_txid)
        if (p?.slug) {
          n.articleHref = p.legacy
            ? `/${encodeURIComponent(p.slug)}`
            : `/posts/${encodeURIComponent(p.slug)}`
          n.articleTitle = p.title ?? null
        }
      }
    } catch {
      /* best-effort; the bell falls back to a generic, unlinked line */
    }
  }

  // Resolve each actor's byline LIVE from their account, overriding the frozen
  // actor_identity snapshot — same policy as the feed and activity rail. This
  // (a) heals a stale snapshot after the actor changes address or binds a handle,
  // and (b) fixes rows that snapshotted a linked NON-primary wallet (an article
  // unlock paid from the Pocket stored the pocket address). Precedence: current
  // @handle → the account's primary wallet address → the frozen snapshot.
  const actorIds = [...new Set(rows.map((n) => n.actor_account_id).filter(Boolean))]
  if (actorIds.length > 0) {
    try {
      const [handleMap, { data: addrRows }] = await Promise.all([
        displayHandlesByAccountId(actorIds, supabase),
        supabase
          .from('account_addresses')
          .select('account_id, address')
          .in('account_id', actorIds)
          .eq('is_primary', true),
      ])
      const primaryByAccount = new Map(
        (addrRows ?? []).map((r) => [r.account_id, r.address]),
      )
      for (const n of rows) {
        const handle = handleMap[n.actor_account_id]?.handle
        if (handle) {
          n.actor_identity = `@${handle}`
          continue
        }
        const primary = primaryByAccount.get(n.actor_account_id)
        if (primary) n.actor_identity = primary // ecash:… form; the bell truncates
      }
    } catch {
      /* best-effort; the bell falls back to the frozen actor_identity */
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
