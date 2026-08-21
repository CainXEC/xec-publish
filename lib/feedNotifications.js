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

import { offerFreshnessCutoffIso } from '@/lib/offerFreshness'
import { displayHandlesByAccountId } from '@/lib/authorDisplayHandles'
import { accountIdForAuthorId } from '@/lib/accountAuthorLink'
import { tokenizeMentions } from '@/lib/contentLinks'
import { skeleton } from '@/lib/handleSkeleton'

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
  // The handle a bidder offered on was LISTED on Agora at their offered price —
  // post_txid = the handle token id, amount_sats = the listed (offer) price.
  // Fired by the marketplace's lazy reconcile, not a click (see handleOffers).
  'offer_listed',
  // A direct tip to the author from their profile (no post_txid; amount_sats is
  // the full tipped amount — a tip is 100% to the author, no platform fee).
  'tip',
  // The recipient is a forum RUNNER and just earned the 6% engagement fee on a
  // reply or reaction to a post in their forum. amount_sats = the 6% they earned;
  // post_txid = the post that was engaged with; emoji set for a reaction.
  'forum_fee',
  // Someone @-tagged the recipient. Fires on a feed post (post_txid = the post's
  // own feed txid; action_txid = same, so the page shows the post text inline) or
  // an article (post_txid = the article's posts.id → article-decorated at read).
  'mention',
  ...ARTICLE_NOTIF_TYPES,
]

// A bare eCash-address mention (no ecash: prefix) is exactly 42 chars — same
// convention as contentLinks' MENTION_SOURCE. Anything else is a @handle.
const MENTION_ADDRESS_RE = /^[a-z0-9]{42}$/
// Abuse bounds: scan at most this many raw mention tokens per post, and notify
// at most this many DISTINCT accounts — so a post spamming @everyone can't fan
// out into a notification flood.
const MENTION_TOKENS_SCANNED_MAX = 30
const MENTION_RECIPIENTS_MAX = 10

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
 * A byline snapshot for an account (current @handle, else its primary address).
 * Only a best-effort fallback: getFeedNotifications re-resolves actor_identity
 * LIVE on every read, so this just seeds the row. Returns '' if nothing resolves.
 */
async function bylineForAccount(supabase, accountId) {
  if (!accountId) return ''
  try {
    const map = await displayHandlesByAccountId([accountId], supabase)
    const handle = map[accountId]?.handle
    if (handle) return `@${handle}`
    const { data: primary } = await supabase
      .from('account_addresses')
      .select('address')
      .eq('account_id', accountId)
      .eq('is_primary', true)
      .limit(1)
      .maybeSingle()
    return primary?.address ? String(primary.address) : ''
  } catch {
    return ''
  }
}

/**
 * Resolve a batch of mention tokens (each a @handle or a bare eCash address, WITHOUT
 * the leading @) to the distinct account ids they refer to. Batched (two queries for
 * handles, one for addresses) rather than per-token. Deduped by ACCOUNT — @alice and
 * @<alice's address> collapse to one — with the excluded accounts (the actor, plus any
 * already notified by a reply/quote) removed, and the result capped. A handle not
 * currently displayed by any account (a handle-only mint) resolves to nothing and is
 * simply skipped. Never throws.
 */
export async function resolveMentionAccountIds(supabase, handles, { excludeAccountIds = [] } = {}) {
  const tokens = [...new Set((handles ?? []).filter(Boolean))].slice(0, MENTION_TOKENS_SCANNED_MAX)
  if (tokens.length === 0) return []

  const addresses = []
  const skeletonToHandles = new Set()
  for (const raw of tokens) {
    const t = String(raw).trim()
    if (MENTION_ADDRESS_RE.test(t.toLowerCase())) addresses.push(t.toLowerCase())
    else {
      const sk = skeleton(t)
      if (sk) skeletonToHandles.add(sk)
    }
  }

  const accountIds = new Set()
  try {
    // Address mentions → accounts (one query over both stored forms).
    if (addresses.length > 0) {
      const forms = [...new Set(addresses.flatMap((a) => [a, `ecash:${a}`]))]
      const { data } = await supabase
        .from('account_addresses')
        .select('account_id')
        .in('address', forms)
      for (const r of data ?? []) if (r.account_id) accountIds.add(r.account_id)
    }
    // Handle mentions → token ids → the account currently DISPLAYING each handle.
    if (skeletonToHandles.size > 0) {
      const { data: handleRows } = await supabase
        .from('handles')
        .select('token_id, handle_skeleton')
        .in('handle_skeleton', [...skeletonToHandles])
      const tokenIds = [...new Set((handleRows ?? []).map((r) => r.token_id).filter(Boolean))]
      if (tokenIds.length > 0) {
        const { data: acctRows } = await supabase
          .from('accounts')
          .select('id')
          .in('active_handle_token_id', tokenIds)
        for (const r of acctRows ?? []) if (r.id) accountIds.add(r.id)
      }
    }
  } catch (e) {
    console.error('[feed-notif] mention resolve failed', e?.message ?? e)
    return []
  }

  for (const ex of excludeAccountIds) accountIds.delete(ex)
  return [...accountIds].slice(0, MENTION_RECIPIENTS_MAX)
}

/**
 * Notify everyone @-mentioned in a FEED post's text (best-effort, non-blocking).
 * postTxid = the post's own feed txid, so action_txid lets the notifications page
 * show the post inline. `excludeAccountIds` skips people already notified by a
 * reply/quote on the same post so they don't get a duplicate ping.
 */
export async function recordFeedMentionNotifications(
  supabase,
  { content, actorAccountId, actorIdentity, postTxid, excludeAccountIds = [] },
) {
  if (!content || !actorAccountId || !postTxid) return
  try {
    const handles = tokenizeMentions(content)
      .filter((t) => t.type === 'mention')
      .map((t) => t.handle)
    const recipients = await resolveMentionAccountIds(supabase, handles, {
      excludeAccountIds: [actorAccountId, ...excludeAccountIds],
    })
    for (const recipientAccountId of recipients) {
      await recordFeedNotification(supabase, {
        recipientAccountId,
        actorAccountId,
        actorIdentity,
        type: 'mention',
        postTxid,
        actionTxid: postTxid, // the post's own txid → inline text on the page
      })
    }
  } catch (e) {
    console.error('[feed-notif] feed mention notif threw (post still ok)', e)
  }
}

/** Pull @handle / @address mention tokens out of stored article HTML. Mentions
 *  are baked in as `<a data-pow href="/@handle">` at publish (articleBodyLinks),
 *  so the profile hrefs ARE the mention set — matching the feed's tokenizer. */
export function extractArticleMentionHandles(html) {
  const src = typeof html === 'string' ? html : ''
  if (!src) return []
  const out = []
  const re = /href="\/@([A-Za-z0-9_]{1,15}|[a-z0-9]{42})"/g
  let m
  while ((m = re.exec(src))) out.push(m[1])
  return out
}

/**
 * Notify everyone @-mentioned in a newly-PUBLISHED article (best-effort). Fire on
 * the first-publish transition only, so edits/re-publishes never re-notify.
 * post_txid = the article's posts.id (article-decorated at read time → links to
 * the article, shows its title, no inline body). Never throws.
 */
export async function recordArticleMentionNotifications(supabase, { postId }) {
  if (!postId) return
  try {
    const { data: post } = await supabase
      .from('posts')
      .select('id, body, author_id')
      .eq('id', postId)
      .maybeSingle()
    if (!post?.body || !post.author_id) return
    const actorAccountId = await accountIdForAuthorId(supabase, post.author_id)
    if (!actorAccountId) return
    const handles = extractArticleMentionHandles(post.body)
    const recipients = await resolveMentionAccountIds(supabase, handles, {
      excludeAccountIds: [actorAccountId],
    })
    if (recipients.length === 0) return
    const actorIdentity = await bylineForAccount(supabase, actorAccountId)
    for (const recipientAccountId of recipients) {
      await recordFeedNotification(supabase, {
        recipientAccountId,
        actorAccountId,
        actorIdentity,
        type: 'mention',
        postTxid: postId, // the article's posts.id → article-linked at read time
      })
    }
  } catch (e) {
    console.error('[feed-notif] article mention notif threw (publish still ok)', e)
  }
}

/**
 * Notify everyone @-mentioned in an article COMMENT (best-effort, non-blocking).
 * Like the article-BODY mention it carries the article's posts.id in post_txid
 * (so it decorates with the article title + link), but ALSO sets action_txid = the
 * comment's txid — the marker that tells the notifications page it's a COMMENT
 * mention, so it links to the article's #comments section. `excludeAccountIds`
 * skips whoever the comment/reply ping already notified (article author / parent
 * commenter), and the actor is always excluded. Never throws.
 */
export async function recordCommentMentionNotifications(
  supabase,
  { content, actorAccountId, actorIdentity, postId, commentTxid, excludeAccountIds = [] },
) {
  if (!content || !actorAccountId || !postId) return
  try {
    const handles = tokenizeMentions(content)
      .filter((t) => t.type === 'mention')
      .map((t) => t.handle)
    const recipients = await resolveMentionAccountIds(supabase, handles, {
      excludeAccountIds: [actorAccountId, ...excludeAccountIds],
    })
    for (const recipientAccountId of recipients) {
      await recordFeedNotification(supabase, {
        recipientAccountId,
        actorAccountId,
        actorIdentity,
        type: 'mention',
        postTxid: postId, // article id → article-decorated (title + link)
        actionTxid: commentTxid, // marks it a COMMENT mention → links to #comments
      })
    }
  } catch (e) {
    console.error('[feed-notif] comment mention notif threw (comment still ok)', e)
  }
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
 *           actorAddress?: string | null, actionTxid?: string | null }} event
 */
export async function recordArticleNotification(
  supabase,
  {
    postId,
    type,
    actorAccountId = null,
    actorIdentity = null,
    actorAddress = null,
    amountSats = null,
    actionTxid = null,
  },
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
      actionTxid, // a top-level comment's own txid, so the page can show its text
    })
  } catch (e) {
    console.error('[feed-notif] article notif threw (action still ok)', e)
  }
}

const NOTIF_COLUMNS =
  'id, recipient_account_id, actor_account_id, actor_identity, type, post_txid, action_txid, amount_sats, emoji, read, created_at'

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
 *           amountSats?: number | null,
 *           actionTxid?: string | null }} event
 */
export async function recordFeedNotification(
  supabase,
  {
    recipientAccountId,
    actorAccountId,
    actorIdentity,
    type,
    postTxid = null,
    amountSats = null,
    actionTxid = null,
    emoji = null,
  },
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
      // Which emoji a 'like' reaction was, so the bell can read "reacted 🔥".
      emoji: typeof emoji === 'string' ? emoji : null,
      post_txid: postTxid,
      // The specific reply/comment's OWN txid (reply, comment) — distinct from
      // post_txid, which is the TARGET being acted on. Lets the notifications
      // page fetch and show the actual text, not just "replied to your post".
      // Unused for quote (post_txid there already is the quote's own txid).
      action_txid: actionTxid,
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
  // Both 'offer' (a bid on YOUR handle) and 'offer_listed' (a handle you bid on
  // got listed at your price) carry the handle's token id in post_txid → decorate
  // with the handle name. 'offer' shows the BIDDER's live amount (actor = bidder);
  // 'offer_listed' shows the listed price stored on the row (actor = the seller).
  const offerRows = rows.filter(
    (n) => (n.type === 'offer' || n.type === 'offer_listed') && n.post_txid,
  )
  if (offerRows.length > 0) {
    const offerTokenIds = [...new Set(offerRows.map((n) => n.post_txid))]
    try {
      const [{ data: handles }, { data: offers }] = await Promise.all([
        supabase.from('handles').select('token_id, handle').in('token_id', offerTokenIds),
        supabase
          .from('handle_offers')
          .select('token_id, bidder_account_id, amount_sats')
          .in('token_id', offerTokenIds)
          .eq('status', 'open')
          .gte('updated_at', offerFreshnessCutoffIso()),
      ])
      const byToken = new Map((handles ?? []).map((h) => [h.token_id, h.handle]))
      const amountByOffer = new Map(
        (offers ?? []).map((o) => [`${o.token_id}:${o.bidder_account_id}`, o.amount_sats]),
      )
      for (const n of offerRows) {
        n.handle = byToken.get(n.post_txid) ?? null
        if (n.type === 'offer_listed') {
          // The listed price is frozen on the notification row (n.amount_sats).
          n.offerAmountXec = n.amount_sats == null ? null : n.amount_sats / 100
        } else {
          const sats = amountByOffer.get(`${n.post_txid}:${n.actor_account_id}`)
          n.offerAmountXec = sats == null ? null : sats / 100
        }
      }
    } catch {
      /* best-effort decoration; the bell falls back to generic copy */
    }
  }

  // Article rows (unlock / comment) carry the article's post id in post_txid.
  // Resolve it to the article's link + title so the bell can say "unlocked
  // <Title>" and open /posts/<slug> (legacy posts live at /<slug>). An article
  // MENTION is article-linked too — its post_txid is the article's posts.id, NOT
  // a 64-hex feed txid. That id-shape check (rather than "no action_txid") is
  // what tells an article mention from a FEED mention, so it also covers a COMMENT
  // mention (article-id post_txid + a comment action_txid).
  const isFeedTxid = (v) => /^[0-9a-f]{64}$/i.test(String(v ?? ''))
  const articleRows = rows.filter(
    (n) =>
      (ARTICLE_NOTIF_TYPES.includes(n.type) ||
        (n.type === 'mention' && !isFeedTxid(n.post_txid))) &&
      n.post_txid,
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

  // The notifications PAGE shows the actual text inline (X-style), not just the
  // verb — three disjoint lookups, each keyed by a different txid meaning:
  //   reply    -> action_txid (the reply's OWN row)      -> feed_posts
  //   quote    -> post_txid   (already the quote's OWN txid, no action_txid) -> feed_posts
  //   comment  -> action_txid (the comment's OWN row)      -> comments
  //   like/repost -> post_txid (the TARGET post — the recipient's own content,
  //                  so showing it back is never a paywall concern) -> feed_posts
  // comment_like intentionally carries no body — the target is a paywalled
  // comment thread, and the recipient already knows what they wrote.
  const replyTxids = rows.filter((n) => n.type === 'reply' && n.action_txid).map((n) => n.action_txid)
  const quoteTxids = rows.filter((n) => n.type === 'quote' && n.post_txid).map((n) => n.post_txid)
  const targetTxids = rows
    .filter((n) => (n.type === 'like' || n.type === 'repost') && n.post_txid)
    .map((n) => n.post_txid)
  // A FEED mention carries action_txid = the post's own feed txid, so it shows the
  // post text inline (an article mention has no action_txid and is handled above).
  const mentionTxids = rows.filter((n) => n.type === 'mention' && n.action_txid).map((n) => n.action_txid)
  const feedPostTxids = [...new Set([...replyTxids, ...quoteTxids, ...targetTxids, ...mentionTxids])]
  const commentTxids = [
    ...new Set(rows.filter((n) => n.type === 'comment' && n.action_txid).map((n) => n.action_txid)),
  ]
  if (feedPostTxids.length > 0 || commentTxids.length > 0) {
    try {
      const [{ data: posts }, { data: comments }] = await Promise.all([
        feedPostTxids.length > 0
          ? supabase.from('feed_posts').select('txid, content, deleted_at').in('txid', feedPostTxids)
          : Promise.resolve({ data: [] }),
        commentTxids.length > 0
          ? supabase
              .from('comments')
              .select('txid, content, deleted_at, parent_id')
              .in('txid', commentTxids)
          : Promise.resolve({ data: [] }),
      ])
      const postByTxid = new Map((posts ?? []).map((p) => [p.txid, p]))
      const commentByTxid = new Map((comments ?? []).map((c) => [c.txid, c]))
      // Three body states, distinguished so the client can tell them apart:
      //  - actionContent set   -> show the text
      //  - actionGone = true   -> a pointer existed but the row is deleted/missing
      //                           ("This reply is no longer available.")
      //  - neither set         -> no pointer at all (an OLD notification, from
      //                           before action_txid existed) -> show just the
      //                           verb line, NOT a false "no longer available".
      const bodyOf = (row) => (row && !row.deleted_at ? row.content ?? '' : null)
      for (const n of rows) {
        if (n.type === 'reply') {
          if (!n.action_txid) continue // old row, no pointer — verb line only
          const text = bodyOf(postByTxid.get(n.action_txid))
          if (text == null) n.actionGone = true
          else n.actionContent = text
        } else if (n.type === 'quote' && n.post_txid) {
          // A quote's post_txid IS its own txid, so quotes resolve for old rows too.
          const text = bodyOf(postByTxid.get(n.post_txid))
          if (text == null) n.actionGone = true
          else n.actionContent = text
        } else if (n.type === 'comment') {
          if (!n.action_txid) continue // old row, no pointer — verb line only
          const c = commentByTxid.get(n.action_txid)
          const text = bodyOf(c)
          if (text == null) n.actionGone = true
          else {
            n.actionContent = text
            // parent_id present -> a reply to another comment, not a top-level
            // article comment — a nicer verb ("replied to your comment").
            n.isCommentReply = Boolean(c?.parent_id)
          }
        } else if ((n.type === 'like' || n.type === 'repost') && n.post_txid) {
          n.targetContent = bodyOf(postByTxid.get(n.post_txid))
        } else if (n.type === 'mention' && n.action_txid) {
          // FEED mention: show the post the recipient was tagged in. (An article
          // mention has no action_txid — it's article-linked above instead.)
          const text = bodyOf(postByTxid.get(n.action_txid))
          if (text == null) n.actionGone = true
          else n.actionContent = text
        }
      }
    } catch {
      /* best-effort; the page falls back to the plain verb line */
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
        const entry = handleMap[n.actor_account_id]
        if (entry?.handle) {
          n.actor_identity = `@${entry.handle}`
          // Carry the actor's chosen handle color so the notifications page tints
          // their name like everywhere else (only a live @handle gets a color).
          n.actor_color = entry.color ?? null
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
