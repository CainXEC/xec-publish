import { createServerSupabase } from '@/lib/supabase-server'
import { FEED_ACTION } from '@/lib/feedProtocol'
import { extractArticleSlug } from '@/lib/articleLinks'

const FEED_POST_COLUMNS =
  'id, txid, action, parent_txid, quoted_txid, content, content_hash, author_account_id, author_identity, payer_address, payout_address, amount_sats, created_at, deleted_at'

// Top-level timeline entries: original posts and quotes (not replies).
const TOP_LEVEL_ACTIONS = [FEED_ACTION.POST, FEED_ACTION.QUOTE]

/** Shape a DB row for the client. A soft-deleted post keeps its slot (so threads
 *  stay navigable) but its content is withheld and flagged as a tombstone. */
function toClientPost(row) {
  if (!row) return row
  const deleted = row.deleted_at != null
  return {
    ...row,
    content: deleted ? null : row.content,
    deleted,
  }
}

function replyCountsByTxid(rows) {
  const map = {}
  if (!Array.isArray(rows)) return map
  for (const r of rows) {
    if (r?.parent_txid == null) continue
    const n = typeof r.count === 'number' ? r.count : Number(r.count)
    map[r.parent_txid] = Number.isFinite(n) ? n : 0
  }
  return map
}

async function attachReplyCounts(supabase, posts) {
  const txids = posts.map((p) => p.txid).filter(Boolean)
  if (txids.length === 0) return posts.map((p) => ({ ...toClientPost(p), replyCount: 0 }))
  const { data } = await supabase.rpc('get_feed_reply_counts', { post_txids: txids })
  const counts = replyCountsByTxid(data ?? [])
  return posts.map((p) => ({ ...toClientPost(p), replyCount: counts[p.txid] ?? 0 }))
}

/**
 * Attach like/repost counts (and, when a viewer address is given, whether that
 * wallet has already reacted) to a batch of already-shaped posts. Reactions live
 * in feed_events keyed by target_txid; likes are action 5, reposts action 4.
 */
async function attachEngagement(supabase, posts, viewerAddress = '') {
  const zeroed = (p) => ({
    ...p,
    likeCount: 0,
    repostCount: 0,
    likedByViewer: false,
    repostedByViewer: false,
  })
  const txids = posts.map((p) => p.txid).filter(Boolean)
  if (txids.length === 0) return posts.map(zeroed)

  const { data: countRows } = await supabase.rpc('get_feed_event_counts', { post_txids: txids })
  const likeCounts = {}
  const repostCounts = {}
  for (const r of countRows ?? []) {
    const n = typeof r.count === 'number' ? r.count : Number(r.count) || 0
    if (r.action === FEED_ACTION.LIKE) likeCounts[r.target_txid] = n
    else if (r.action === FEED_ACTION.REPOST) repostCounts[r.target_txid] = n
  }

  const likedByViewer = new Set()
  const repostedByViewer = new Set()
  const addr = typeof viewerAddress === 'string' ? viewerAddress.trim() : ''
  if (addr) {
    const { data: mine } = await supabase
      .from('feed_events')
      .select('target_txid, action')
      .eq('payer_address', addr)
      .in('target_txid', txids)
    for (const r of mine ?? []) {
      if (r.action === FEED_ACTION.LIKE) likedByViewer.add(r.target_txid)
      else if (r.action === FEED_ACTION.REPOST) repostedByViewer.add(r.target_txid)
    }
  }

  return posts.map((p) => ({
    ...p,
    likeCount: likeCounts[p.txid] ?? 0,
    repostCount: repostCounts[p.txid] ?? 0,
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
    .select('slug, title, teaser, price_xec')
    .in('slug', slugs)
    .eq('published', true)
    .eq('legacy', false)

  const bySlug = {}
  for (const r of rows ?? []) {
    bySlug[r.slug] = {
      slug: r.slug,
      title: r.title ?? '',
      teaser: r.teaser ?? '',
      priceXec: r.price_xec ?? null,
    }
  }

  return posts.map((p) => {
    const slug = slugByPost.get(p)
    return { ...p, articleCard: slug ? bySlug[slug] ?? null : null }
  })
}

/** Shape + enrich a batch of raw feed_posts rows for the client. */
async function decoratePosts(supabase, rows, { viewerAddress = '', viewerAccountId = null } = {}) {
  const withCounts = await attachReplyCounts(supabase, rows)
  const withEngagement = await attachEngagement(supabase, withCounts, viewerAddress)
  const withQuoted = await attachQuoted(supabase, withEngagement)
  const withFollow = await attachFollowState(supabase, withQuoted, viewerAccountId)
  return attachArticleCards(supabase, withFollow)
}

/**
 * Newest-first page of top-level feed entries (original posts + quotes).
 * @returns {Promise<{ posts: object[], hasNextPage: boolean }>}
 */
export async function getFeedPage({ page = 1, pageSize = 25, viewerAddress = '', viewerAccountId = null } = {}) {
  const pageNum = Math.max(1, Number(page) || 1)
  const pageSizeNum = Math.max(1, Number(pageSize) || 25)
  const start = (pageNum - 1) * pageSizeNum
  const end = start + pageSizeNum - 1

  const supabase = createServerSupabase()
  const { data: rows, error } = await supabase
    .from('feed_posts')
    .select(FEED_POST_COLUMNS)
    .in('action', TOP_LEVEL_ACTIONS)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .range(start, end)

  if (error) {
    throw new Error(error.message)
  }

  const rowsList = rows ?? []
  const posts = await decoratePosts(supabase, rowsList, { viewerAddress, viewerAccountId })
  return { posts, hasNextPage: rowsList.length === pageSizeNum }
}

/**
 * Newest-first page of top-level posts authored by accounts the viewer follows.
 * The follow graph (feed_follows) is keyed by account id on both sides, matching
 * feed_posts.author_account_id directly — so we read the viewer's followees and
 * filter the feed to that set. An empty follow set (or no viewer) yields an empty
 * page rather than the global feed.
 * @returns {Promise<{ posts: object[], hasNextPage: boolean }>}
 */
export async function getFollowingFeedPage({ page = 1, pageSize = 25, viewerAddress = '', viewerAccountId = null } = {}) {
  const viewer = typeof viewerAccountId === 'string' ? viewerAccountId.trim() : ''
  if (!viewer) return { posts: [], hasNextPage: false }

  const pageNum = Math.max(1, Number(page) || 1)
  const pageSizeNum = Math.max(1, Number(pageSize) || 25)
  const start = (pageNum - 1) * pageSizeNum
  const end = start + pageSizeNum - 1

  const supabase = createServerSupabase()

  const { data: followRows, error: followErr } = await supabase
    .from('feed_follows')
    .select('followee_account_id')
    .eq('follower_account_id', viewer)
  if (followErr) throw new Error(followErr.message)

  const accountIds = [
    ...new Set((followRows ?? []).map((r) => r.followee_account_id).filter(Boolean)),
  ]
  if (accountIds.length === 0) return { posts: [], hasNextPage: false }

  const { data: rows, error } = await supabase
    .from('feed_posts')
    .select(FEED_POST_COLUMNS)
    .in('action', TOP_LEVEL_ACTIONS)
    .is('deleted_at', null)
    .in('author_account_id', accountIds)
    .order('created_at', { ascending: false })
    .range(start, end)
  if (error) throw new Error(error.message)

  const rowsList = rows ?? []
  const posts = await decoratePosts(supabase, rowsList, { viewerAddress, viewerAccountId: viewer })
  return { posts, hasNextPage: rowsList.length === pageSizeNum }
}

/**
 * Newest-first page of top-level posts (originals + quotes) authored by ONE
 * account — the "their posts" timeline on a profile page. Replies are excluded
 * so a profile reads like a Twitter feed of the account's own posts.
 * @returns {Promise<{ posts: object[], hasNextPage: boolean }>}
 */
export async function getAccountFeedPage({ accountId, page = 1, pageSize = 25, viewerAddress = '', viewerAccountId = null } = {}) {
  const account = typeof accountId === 'string' ? accountId.trim() : ''
  if (!account) return { posts: [], hasNextPage: false }

  const pageNum = Math.max(1, Number(page) || 1)
  const pageSizeNum = Math.max(1, Number(pageSize) || 25)
  const start = (pageNum - 1) * pageSizeNum
  const end = start + pageSizeNum - 1

  const supabase = createServerSupabase()
  const { data: rows, error } = await supabase
    .from('feed_posts')
    .select(FEED_POST_COLUMNS)
    .in('action', TOP_LEVEL_ACTIONS)
    .is('deleted_at', null)
    .eq('author_account_id', account)
    .order('created_at', { ascending: false })
    .range(start, end)
  if (error) throw new Error(error.message)

  const rowsList = rows ?? []
  const posts = await decoratePosts(supabase, rowsList, { viewerAddress, viewerAccountId })
  return { posts, hasNextPage: rowsList.length === pageSizeNum }
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

  const opts = { viewerAddress, viewerAccountId }
  const [post] = await decoratePosts(supabase, [postRow], opts)
  const ancestors = await decoratePosts(supabase, ancestorRows, opts)
  const replies = await decoratePosts(supabase, replyRows ?? [], opts)
  return { post, ancestors, replies }
}
