import { unstable_cache } from 'next/cache'
import { createServerSupabase } from '@/lib/supabase-server'
import { FEED_ACTION } from '@/lib/feedProtocol'
import { extractArticleSlug } from '@/lib/articleLinks'
import { displayHandlesByAccountId } from '@/lib/authorDisplayHandles'
import { blockedAccountIds } from '@/lib/feedBlocks'
import { encodeCursor, decodeCursor, applyCursor } from '@/lib/feedCursor'
import { rankFeedCandidates } from '@/lib/feedRanking'

// Cache tag for the shared, viewer-neutral "For You" feed. Invalidated on new
// top-level posts and deletes (revalidateTag) so the feed freshens within
// seconds; absent an invalidation it rides the revalidate window below.
export const FEED_CACHE_TAG = 'feed:foryou'
const FEED_CACHE_REVALIDATE_SECONDS = 30

const FEED_POST_COLUMNS =
  'id, txid, action, parent_txid, quoted_txid, content, content_hash, author_account_id, author_identity, payer_address, payout_address, amount_sats, created_at, deleted_at, reply_count, like_count, repost_count'

// Top-level timeline entries: original posts and quotes (not replies).
const TOP_LEVEL_ACTIONS = [FEED_ACTION.POST, FEED_ACTION.QUOTE]

/** Shape a DB row for the client. A soft-deleted post keeps its slot (so threads
 *  stay navigable) but its content is withheld and flagged as a tombstone. The
 *  engagement counts ride along on the row itself — maintained by DB triggers
 *  (sql/feed_reaction_counts.sql) — so no per-read aggregation is needed. */
function toClientPost(row) {
  if (!row) return row
  const deleted = row.deleted_at != null
  return {
    ...row,
    content: deleted ? null : row.content,
    deleted,
    replyCount: row.reply_count ?? 0,
    likeCount: row.like_count ?? 0,
    repostCount: row.repost_count ?? 0,
  }
}

/**
 * Mark whether the given viewer wallet has already liked/reposted each post.
 * Counts themselves come denormalized on the row (see toClientPost); this only
 * resolves the viewer's OWN reactions, which can't be denormalized per-post.
 * Reactions live in feed_events keyed by target_txid; likes are action 5,
 * reposts action 4. No viewer address → everything false.
 */
async function attachViewerReactions(supabase, posts, viewerAddress = '') {
  const withDefaults = posts.map((p) => ({
    ...p,
    likedByViewer: false,
    repostedByViewer: false,
  }))
  const addr = typeof viewerAddress === 'string' ? viewerAddress.trim() : ''
  const txids = withDefaults.map((p) => p.txid).filter(Boolean)
  if (!addr || txids.length === 0) return withDefaults

  const likedByViewer = new Set()
  const repostedByViewer = new Set()
  const { data: mine } = await supabase
    .from('feed_events')
    .select('target_txid, action')
    .eq('payer_address', addr)
    .in('target_txid', txids)
  for (const r of mine ?? []) {
    if (r.action === FEED_ACTION.LIKE) likedByViewer.add(r.target_txid)
    else if (r.action === FEED_ACTION.REPOST) repostedByViewer.add(r.target_txid)
  }

  return withDefaults.map((p) => ({
    ...p,
    likedByViewer: likedByViewer.has(p.txid),
    repostedByViewer: repostedByViewer.has(p.txid),
  }))
}

/**
 * For quote posts, attach a shallow preview of the quoted post as `post.quoted`
 * (byline + content, tombstoned if the quoted post was deleted, null if it's
 * missing). The preview is intentionally shallow — no nested engagement/quotes.
 */
async function attachQuoted(supabase, posts) {
  const quotedTxids = [...new Set(posts.map((p) => p.quoted_txid).filter(Boolean))]
  if (quotedTxids.length === 0) return posts

  const { data: rows } = await supabase
    .from('feed_posts')
    .select(FEED_POST_COLUMNS)
    .in('txid', quotedTxids)
  const byTxid = {}
  for (const r of rows ?? []) byTxid[r.txid] = toClientPost(r)

  return posts.map((p) =>
    p.quoted_txid ? { ...p, quoted: byTxid[p.quoted_txid] ?? null } : p,
  )
}

/**
 * Attach `followedByViewer` (whether the signed-in viewer follows each post's
 * author account). Follows are keyed by (follower_account_id -> followee_account_id)
 * in feed_follows; the followee is the post's author_account_id. A viewer's own
 * posts are never marked followed. No viewer id → everything false.
 */
async function attachFollowState(supabase, posts, viewerAccountId = null) {
  const viewer = typeof viewerAccountId === 'string' ? viewerAccountId : ''
  if (!viewer) return posts.map((p) => ({ ...p, followedByViewer: false }))

  const authorIds = [
    ...new Set(
      posts
        .map((p) => p.author_account_id)
        .filter((id) => id && id !== viewer),
    ),
  ]
  const followed = new Set()
  if (authorIds.length > 0) {
    const { data: rows } = await supabase
      .from('feed_follows')
      .select('followee_account_id')
      .eq('follower_account_id', viewer)
      .in('followee_account_id', authorIds)
    for (const r of rows ?? []) followed.add(r.followee_account_id)
  }

  return posts.map((p) => ({
    ...p,
    followedByViewer: followed.has(p.author_account_id),
  }))
}

/**
 * When a post's text links to an on-site article (/posts/<slug>), attach a
 * shallow preview of that article as `post.articleCard` so the feed can render a
 * link card. Only published, non-legacy articles resolve; anything else (bad
 * slug, unpublished draft) yields null. Deleted posts (content withheld) are
 * skipped.
 */
async function attachArticleCards(supabase, posts) {
  const slugByPost = new Map()
  for (const p of posts) {
    if (p.deleted) continue
    const slug = extractArticleSlug(p.content)
    if (slug) slugByPost.set(p, slug)
  }
  if (slugByPost.size === 0) return posts.map((p) => ({ ...p, articleCard: null }))

  const slugs = [...new Set(slugByPost.values())]
  const { data: rows } = await supabase
    .from('posts')
    .select('slug, title, teaser, price_xec, reading_time_minutes, authors(username)')
    .in('slug', slugs)
    .eq('published', true)
    .eq('legacy', false)

  const bySlug = {}
  for (const r of rows ?? []) {
    const author = Array.isArray(r.authors) ? r.authors[0] : r.authors
    bySlug[r.slug] = {
      slug: r.slug,
      title: r.title ?? '',
      teaser: r.teaser ?? '',
      priceXec: r.price_xec ?? null,
      readingTimeMinutes: r.reading_time_minutes ?? null,
      author: author?.username ?? null,
    }
  }

  return posts.map((p) => {
    const slug = slugByPost.get(p)
    return { ...p, articleCard: slug ? bySlug[slug] ?? null : null }
  })
}

/**
 * Attach `displayIdentity`: the byline to actually render, resolved LIVE from
 * the poster's account rather than the identity frozen at write time. If the
 * account currently displays a handle we show "@handle"; if it has since
 * sold/unbound the handle we fall back to the payer address — so a handle only
 * ever appears on posts by the account that currently holds it. The frozen
 * `author_identity` is left intact for history; only display changes. Quoted
 * previews get the same treatment so their bylines stay live too.
 */
async function attachLiveIdentity(supabase, posts) {
  const accountIds = []
  for (const p of posts) {
    if (p.author_account_id) accountIds.push(p.author_account_id)
    if (p.quoted?.author_account_id) accountIds.push(p.quoted.author_account_id)
  }
  const handleMap = await displayHandlesByAccountId(accountIds, supabase)

  const identityFor = (row) => {
    if (!row) return row
    const handle = row.author_account_id ? handleMap[row.author_account_id] : null
    return handle ? `@${handle}` : row.payer_address || row.author_identity
  }

  return posts.map((p) => ({
    ...p,
    displayIdentity: identityFor(p),
    quoted: p.quoted ? { ...p.quoted, displayIdentity: identityFor(p.quoted) } : p.quoted,
  }))
}

/** Shape + enrich a batch of raw feed_posts rows for the client. */
async function decoratePosts(supabase, rows, { viewerAddress = '', viewerAccountId = null } = {}) {
  const shaped = (rows ?? []).map(toClientPost)
  const withReactions = await attachViewerReactions(supabase, shaped, viewerAddress)
  const withQuoted = await attachQuoted(supabase, withReactions)
  const withFollow = await attachFollowState(supabase, withQuoted, viewerAccountId)
  const withCards = await attachArticleCards(supabase, withFollow)
  return attachLiveIdentity(supabase, withCards)
}

/** Clamp a requested page size to a sane keyset window. */
function normalizePageSize(pageSize) {
  return Math.max(1, Number(pageSize) || 25)
}

/**
 * Turn a raw candidate window (rows ordered created_at DESC, id DESC) into the
 * served page: derive nextCursor from the RAW time order first (so paging stays
 * stable), then rank the window for display, then decorate.
 *
 * nextCursor points at the oldest row in this window (the last element, since the
 * window is newest-first). It's null when the window came back short — meaning
 * there's nothing older to fetch.
 */
async function finalizeWindow(supabase, rows, pageSizeNum, { viewerAddress, viewerAccountId }) {
  const rowsList = rows ?? []
  const full = rowsList.length === pageSizeNum
  const nextCursor = full ? encodeCursor(rowsList[rowsList.length - 1]) : null

  const ranked = rankFeedCandidates(rowsList)
  const posts = await decoratePosts(supabase, ranked, { viewerAddress, viewerAccountId })
  return { posts, nextCursor }
}

/**
 * Newest-first page of top-level feed entries (original posts + quotes), keyset
 * paginated. Pass the previous page's `nextCursor` to fetch the next window;
 * omit it (or pass null) for the first page.
 * @returns {Promise<{ posts: object[], nextCursor: string|null }>}
 */
export async function getFeedPage({ cursor = null, pageSize = 25, viewerAddress = '', viewerAccountId = null } = {}) {
  const pageSizeNum = normalizePageSize(pageSize)
  const decoded = decodeCursor(cursor)

  const supabase = createServerSupabase()
  let query = supabase
    .from('feed_posts')
    .select(FEED_POST_COLUMNS)
    .in('action', TOP_LEVEL_ACTIONS)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
  query = applyCursor(query, decoded).limit(pageSizeNum)

  const { data: rows, error } = await query
  if (error) {
    throw new Error(error.message)
  }

  return finalizeWindow(supabase, rows, pageSizeNum, { viewerAddress, viewerAccountId })
}

/**
 * Shared, viewer-NEUTRAL page of the For You feed, cached across ALL requests
 * (unstable_cache persists it in the Next.js Data Cache). Every visitor — signed
 * in or not — reads the same payload, so thousands of concurrent readers collapse
 * to roughly one DB render per revalidate window instead of one render each.
 *
 * The per-viewer bits (your likes/reposts/follows) are deliberately NOT in here —
 * that's what keeps the payload identical for everyone and therefore cacheable.
 * The client layers them on afterward via POST /api/feed/viewer-state.
 */
export function getCachedForYouPage(cursor = null, pageSize = 25) {
  const pageSizeNum = normalizePageSize(pageSize)
  // The cursor is opaque and stable, so it's a safe cache-key segment: the same
  // window (same boundary) collapses to one shared render. 'start' keys the first
  // page. A malformed cursor decodes to the first page, so normalize it here too
  // to avoid caching garbage tokens as distinct keys.
  const cursorKey = decodeCursor(cursor) ? cursor : 'start'
  return unstable_cache(
    () => getFeedPage({ cursor: cursorKey === 'start' ? null : cursorKey, pageSize: pageSizeNum }),
    ['feed-foryou', cursorKey, String(pageSizeNum)],
    { tags: [FEED_CACHE_TAG], revalidate: FEED_CACHE_REVALIDATE_SECONDS },
  )()
}

/**
 * Newest-first page of top-level posts authored by accounts the viewer follows.
 * The follow graph (feed_follows) is keyed by account id on both sides, matching
 * feed_posts.author_account_id directly — so we read the viewer's followees and
 * filter the feed to that set. An empty follow set (or no viewer) yields an empty
 * page rather than the global feed.
 * @returns {Promise<{ posts: object[], nextCursor: string|null }>}
 */
export async function getFollowingFeedPage({ cursor = null, pageSize = 25, viewerAddress = '', viewerAccountId = null } = {}) {
  const viewer = typeof viewerAccountId === 'string' ? viewerAccountId.trim() : ''
  if (!viewer) return { posts: [], nextCursor: null }

  const pageSizeNum = normalizePageSize(pageSize)
  const decoded = decodeCursor(cursor)

  const supabase = createServerSupabase()

  const { data: followRows, error: followErr } = await supabase
    .from('feed_follows')
    .select('followee_account_id')
    .eq('follower_account_id', viewer)
  if (followErr) throw new Error(followErr.message)

  // Drop anyone in a block relationship with the viewer. Blocking auto-unfollows,
  // but a follow can persist when the OTHER party blocked the viewer (they didn't
  // unfollow us) — so filter here too rather than trusting the follow graph alone.
  const blocked = await blockedAccountIds(supabase, viewer)
  const accountIds = [
    ...new Set(
      (followRows ?? [])
        .map((r) => r.followee_account_id)
        .filter((id) => id && !blocked.has(id)),
    ),
  ]
  if (accountIds.length === 0) return { posts: [], nextCursor: null }

  let query = supabase
    .from('feed_posts')
    .select(FEED_POST_COLUMNS)
    .in('action', TOP_LEVEL_ACTIONS)
    .is('deleted_at', null)
    .in('author_account_id', accountIds)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
  query = applyCursor(query, decoded).limit(pageSizeNum)

  const { data: rows, error } = await query
  if (error) throw new Error(error.message)

  return finalizeWindow(supabase, rows, pageSizeNum, { viewerAddress, viewerAccountId: viewer })
}

/**
 * Newest-first page of top-level posts (originals + quotes) authored by ONE
 * account — the "their posts" timeline on a profile page. Replies are excluded
 * so a profile reads like a Twitter feed of the account's own posts.
 * @returns {Promise<{ posts: object[], nextCursor: string|null }>}
 */
export async function getAccountFeedPage({ accountId, cursor = null, pageSize = 25, viewerAddress = '', viewerAccountId = null } = {}) {
  const account = typeof accountId === 'string' ? accountId.trim() : ''
  if (!account) return { posts: [], nextCursor: null }

  const pageSizeNum = normalizePageSize(pageSize)
  const decoded = decodeCursor(cursor)

  const supabase = createServerSupabase()

  // A block hides the account's posts from the viewer in either direction — an
  // account you blocked (or that blocked you) shows an empty timeline.
  const blocked = await blockedAccountIds(supabase, viewerAccountId)
  if (blocked.has(account)) return { posts: [], nextCursor: null }

  let query = supabase
    .from('feed_posts')
    .select(FEED_POST_COLUMNS)
    .in('action', TOP_LEVEL_ACTIONS)
    .is('deleted_at', null)
    .eq('author_account_id', account)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
  query = applyCursor(query, decoded).limit(pageSizeNum)

  const { data: rows, error } = await query
  if (error) throw new Error(error.message)

  return finalizeWindow(supabase, rows, pageSizeNum, { viewerAddress, viewerAccountId })
}

// Cap the ancestor walk so a pathological/cyclic parent chain can't loop forever.
const MAX_ANCESTORS = 20

/**
 * A single post, its ancestor chain, and its direct replies. `ancestors` is the
 * chain of posts this one is (transitively) replying to, ordered root-first so
 * the thread reads top-to-bottom like X: root → … → parent → focused post →
 * replies. Empty for a top-level post. A soft-deleted ancestor is kept as a
 * tombstone so the chain stays intact.
 * @returns {Promise<{ post: object, ancestors: object[], replies: object[] } | null>}
 */
export async function getFeedThread(txid, { viewerAddress = '', viewerAccountId = null } = {}) {
  const clean = typeof txid === 'string' ? txid.trim().toLowerCase() : ''
  if (!clean) return null

  const supabase = createServerSupabase()
  const { data: postRow, error: postError } = await supabase
    .from('feed_posts')
    .select(FEED_POST_COLUMNS)
    .eq('txid', clean)
    .maybeSingle()

  if (postError) throw new Error(postError.message)
  if (!postRow) return null

  // A block hides the thread both ways: if the focused post's author is in a
  // block relationship with the viewer, treat the post as not found. Replies and
  // ancestors from blocked authors are filtered out of the surrounding context.
  const blocked = await blockedAccountIds(supabase, viewerAccountId)
  if (postRow.author_account_id && blocked.has(postRow.author_account_id)) return null

  const { data: replyRows, error: replyError } = await supabase
    .from('feed_posts')
    .select(FEED_POST_COLUMNS)
    .eq('action', 2)
    .eq('parent_txid', clean)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })

  if (replyError) throw new Error(replyError.message)

  // Walk up the parent chain to build the ancestor context (newest-first here,
  // reversed to root-first below). Stops at a top-level post, a missing parent,
  // a cycle, or the depth cap.
  const ancestorRows = []
  const seen = new Set([clean])
  let cursor = postRow
  while (cursor?.action === 2 && cursor.parent_txid && ancestorRows.length < MAX_ANCESTORS) {
    const parentTxid = cursor.parent_txid
    if (seen.has(parentTxid)) break
    seen.add(parentTxid)
    const { data: parentRow, error: parentError } = await supabase
      .from('feed_posts')
      .select(FEED_POST_COLUMNS)
      .eq('txid', parentTxid)
      .maybeSingle()
    if (parentError) throw new Error(parentError.message)
    if (!parentRow) break
    ancestorRows.push(parentRow)
    cursor = parentRow
  }
  ancestorRows.reverse() // root-first

  const visible = (row) => !(row.author_account_id && blocked.has(row.author_account_id))
  const opts = { viewerAddress, viewerAccountId }
  const [post] = await decoratePosts(supabase, [postRow], opts)
  const ancestors = await decoratePosts(supabase, ancestorRows.filter(visible), opts)
  const replies = await decoratePosts(supabase, (replyRows ?? []).filter(visible), opts)
  return { post, ancestors, replies }
}
