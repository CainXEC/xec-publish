import { cache } from 'react'
import { unstable_cache } from 'next/cache'
import { createServerSupabase } from '@/lib/supabase-server'
import { FEED_ACTION } from '@/lib/feedProtocol'
import { extractArticleSlug } from '@/lib/articleLinks'
import { extractFeedPostTxid } from '@/lib/contentLinks'
import { displayHandlesByAccountId } from '@/lib/authorDisplayHandles'
import { blockedAccountIds } from '@/lib/feedBlocks'
import { encodeCursor, decodeCursor, applyCursor } from '@/lib/feedCursor'
import { rankFeedCandidates, weaveMintRows } from '@/lib/feedRanking'

// Cache tag for the shared, viewer-neutral "For You" feed. Invalidated on new
// top-level posts and deletes (revalidateTag) so the feed freshens within
// seconds; absent an invalidation it rides the revalidate window below.
export const FEED_CACHE_TAG = 'feed:foryou'
const FEED_CACHE_REVALIDATE_SECONDS = 30

const FEED_POST_COLUMNS =
  'id, txid, action, parent_txid, quoted_txid, content, content_hash, author_account_id, author_identity, payer_address, payout_address, amount_sats, created_at, deleted_at, reply_count, like_count, repost_count, quote_count, card_kind, image_url, card_meta'

// Top-level timeline entries: original posts and quotes (not replies).
const TOP_LEVEL_ACTIONS = [FEED_ACTION.POST, FEED_ACTION.QUOTE]

// Mint announcements ride ALONGSIDE the For You window instead of inside it:
// they're excluded from the ranked candidate set (real writing gets all the
// slots, the exploration boosts, and a working author-spread cap), then the
// span's mints are fetched separately and woven back in as compact rows. Up to
// this many mints in a page's span render as individual rows; more collapse
// into one digest row, so a mint rush can never wall off the feed.
const MINT_INLINE_MAX = 3
// Newest-first fetch cap for a span's mint rows. The digest's displayed count
// uses the query's exact count, so it stays right even past this cap.
const MINT_SPAN_FETCH_LIMIT = 30

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
    quoteCount: row.quote_count ?? 0,
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
 * When a post's text links to another on-site feed post (/feed/<txid>) — a pasted
 * link, distinct from a native quote (quoted_txid) — attach a shallow preview of
 * that post as `post.linkedPost` so the feed can render it as a quoted embed,
 * "as if you'd quoted it". Tombstoned if the target was deleted, null if missing.
 * Native quotes are skipped (their embed comes from `quoted`). Deleted posts too.
 */
async function attachLinkedPosts(supabase, posts) {
  const txidByPost = new Map()
  for (const p of posts) {
    if (p.deleted || p.quoted_txid) continue
    const txid = extractFeedPostTxid(p.content)
    if (txid) txidByPost.set(p, txid)
  }
  if (txidByPost.size === 0) return posts

  const txids = [...new Set(txidByPost.values())]
  const { data: rows } = await supabase
    .from('feed_posts')
    .select(FEED_POST_COLUMNS)
    .in('txid', txids)
  const byTxid = {}
  for (const r of rows ?? []) byTxid[r.txid] = toClientPost(r)

  return posts.map((p) => {
    const txid = txidByPost.get(p)
    return txid ? { ...p, linkedPost: byTxid[txid] ?? null } : p
  })
}

/**
 * For replies shown in a timeline (Following feed, profile "Replies" tab), attach
 * a shallow preview of the post being replied to as `post.parent` — just enough to
 * render a "Replying to @X" context line that links back to the thread. Tombstoned
 * if the parent was deleted, null if it's missing or the row isn't a reply. Like
 * attachQuoted, the preview is intentionally shallow (no nested engagement).
 */
async function attachParentPreview(supabase, posts) {
  const parentTxids = [
    ...new Set(
      posts
        .filter((p) => p.action === FEED_ACTION.REPLY && p.parent_txid)
        .map((p) => p.parent_txid),
    ),
  ]
  if (parentTxids.length === 0) return posts.map((p) => ({ ...p, parent: null }))

  const { data: rows } = await supabase
    .from('feed_posts')
    .select(FEED_POST_COLUMNS)
    .in('txid', parentTxids)
  const byTxid = {}
  for (const r of rows ?? []) byTxid[r.txid] = toClientPost(r)

  return posts.map((p) =>
    p.action === FEED_ACTION.REPLY && p.parent_txid
      ? { ...p, parent: byTxid[p.parent_txid] ?? null }
      : { ...p, parent: null },
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
    if (p.parent?.author_account_id) accountIds.push(p.parent.author_account_id)
    if (p.linkedPost?.author_account_id) accountIds.push(p.linkedPost.author_account_id)
    // The reposter's byline ("Reposted by @X") is resolved live too.
    if (p.repostedBy?.accountId) accountIds.push(p.repostedBy.accountId)
  }
  const handleMap = await displayHandlesByAccountId(accountIds, supabase)

  const entryFor = (row) =>
    row?.author_account_id ? handleMap[row.author_account_id] : null

  const identityFor = (row) => {
    if (!row) return row
    const entry = entryFor(row)
    return entry?.handle ? `@${entry.handle}` : row.payer_address || row.author_identity
  }
  // Only a live "@handle" byline carries a custom color; address fallbacks don't.
  const colorFor = (row) => (row ? entryFor(row)?.color ?? null : null)

  const withIdentity = (row) =>
    row
      ? { ...row, displayIdentity: identityFor(row), displayColor: colorFor(row) }
      : row

  // Resolve a repost attribution's live display identity from the reposter's
  // current handle (falling back to the frozen snapshot from write time).
  const repostedByFor = (row) => {
    const rb = row?.repostedBy
    if (!rb?.accountId) return rb ?? null
    const entry = handleMap[rb.accountId]
    return {
      ...rb,
      identity: entry?.handle ? `@${entry.handle}` : rb.identity || null,
      color: entry?.color ?? null,
    }
  }

  return posts.map((p) => ({
    ...p,
    displayIdentity: identityFor(p),
    displayColor: colorFor(p),
    quoted: withIdentity(p.quoted),
    parent: withIdentity(p.parent),
    linkedPost: p.linkedPost !== undefined ? withIdentity(p.linkedPost) : undefined,
    repostedBy: repostedByFor(p),
  }))
}

/** Shape + enrich a batch of raw feed_posts rows for the client. `withParents`
 *  adds the `post.parent` preview for replies (timelines that surface replies —
 *  the Following feed and the profile "Replies" tab — pass it; the top-level For
 *  You feed and profile "Posts" tab don't, since they never include replies). */
async function decoratePosts(
  supabase,
  rows,
  { viewerAddress = '', viewerAccountId = null, withParents = false, attachIdentity = true } = {},
) {
  const shaped = (rows ?? []).map(toClientPost)

  // The six attach steps below are mutually independent: each reads only RAW row
  // fields (txid / quoted_txid / parent_txid / author_account_id / content /
  // deleted) and adds its own disjoint keys — none consumes another's output. So
  // they run over the same window concurrently instead of as six serial DB
  // round-trips. Only attachLiveIdentity (last) depends on earlier outputs: it
  // resolves bylines for the attached quoted/parent/linkedPost previews too.
  const [withReactions, withQuoted, withParent, withFollow, withCards, withLinked] =
    await Promise.all([
      attachViewerReactions(supabase, shaped, viewerAddress),
      attachQuoted(supabase, shaped),
      withParents ? attachParentPreview(supabase, shaped) : Promise.resolve(null),
      attachFollowState(supabase, shaped, viewerAccountId),
      attachArticleCards(supabase, shaped),
      attachLinkedPosts(supabase, shaped),
    ])

  // Merge: start from the raw shape and copy over each step's ADDED keys (any
  // key not already on the raw post), in the same order the old sequential chain
  // applied them — output shape is identical, including keys that are only
  // present conditionally (quoted / linkedPost).
  const copyAdded = (target, source, base) => {
    for (const k in source) if (!(k in base)) target[k] = source[k]
  }
  const merged = shaped.map((p, i) => {
    const out = { ...p }
    copyAdded(out, withReactions[i], p)
    copyAdded(out, withQuoted[i], p)
    if (withParent) copyAdded(out, withParent[i], p)
    copyAdded(out, withFollow[i], p)
    copyAdded(out, withCards[i], p)
    copyAdded(out, withLinked[i], p)
    return out
  })

  // Live @handle + chosen color. Deferrable: the shared For You cache holds
  // identity-NEUTRAL rows and resolves identity AFTER the cache boundary (see
  // getCachedForYouPage), so a rename or recolor reflects instantly instead of
  // riding the 30s cache window. Live timelines resolve it inline here.
  return attachIdentity ? attachLiveIdentity(supabase, merged) : merged
}

/** Clamp a requested page size to a sane keyset window. */
function normalizePageSize(pageSize) {
  return Math.max(1, Number(pageSize) || 25)
}

/**
 * Fetch the paid-engagement ranking signal for a window of posts: distinct paying
 * supporters + total XEC per post, with self/linked-wallet reactions already
 * excluded server-side (see sql/feed_engagement_signal.sql). One RPC call per
 * window — for the cached For You feed this runs inside the cached render, so
 * concurrent readers share it. Returns a Map(txid -> { distinctSupporters,
 * totalAmountSats }); a missing/failed signal yields an empty Map and the ranker
 * degrades gracefully to recency + conversation.
 */
async function fetchEngagementSignals(supabase, rows) {
  const txids = (rows ?? []).map((r) => r.txid).filter(Boolean)
  const signals = new Map()
  if (txids.length === 0) return signals

  const { data, error } = await supabase.rpc('get_feed_engagement_signal', {
    post_txids: txids,
  })
  if (error) {
    // Non-fatal: a feed without the signal is just recency-ordered, not broken.
    console.error('[getFeed] engagement signal RPC failed', error.message)
    return signals
  }
  for (const r of data ?? []) {
    signals.set(r.target_txid, {
      distinctSupporters: Number(r.distinct_supporters) || 0,
      totalAmountSats: Number(r.total_amount_sats) || 0,
    })
  }
  return signals
}

/**
 * Fetch the mint-announcement rows whose surfacing time falls inside this page's
 * time span, newest-first, plus the span's exact total (the digest count).
 *
 * The span is (window's oldest row, incoming cursor]: the upper bound is the
 * cursor this page was fetched with (page 1 has none — the span extends to now),
 * the lower bound is the oldest REAL post served on this page (strict >, so the
 * mint lands exactly once: page N excludes its own boundary, page N+1's lte
 * includes it). A short/final window keeps its oldest-row lower bound — mints
 * older than the last real post in the feed live on the profile gallery, not in
 * an endless tail. An EMPTY window (no real posts left) has no lower bound, so
 * the very last page can still digest whatever mints remain.
 *
 * Non-fatal by design: a failed fetch yields zero mints and the feed serves
 * real posts only. (A mint sharing an exact microsecond timestamp with a
 * boundary real post can slip the span — accepted: vanishingly rare, and it
 * misses rather than duplicates.)
 */
async function fetchSpanMintCards(supabase, rowsList, decoded) {
  let query = supabase
    .from('feed_posts')
    .select(FEED_POST_COLUMNS, { count: 'exact' })
    .eq('card_kind', 'handle_mint')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(MINT_SPAN_FETCH_LIMIT)
  if (decoded?.createdAt) query = query.lte('created_at', decoded.createdAt)
  const oldest = rowsList[rowsList.length - 1]
  if (oldest?.created_at) query = query.gt('created_at', oldest.created_at)

  const { data, count, error } = await query
  if (error) {
    console.error('[getFeed] span mint fetch failed', error.message)
    return { mints: [], mintCount: 0 }
  }
  const mints = data ?? []
  return { mints, mintCount: count ?? mints.length }
}

/**
 * Collapse a span's mints for display: at most MINT_INLINE_MAX ride as
 * individual compact rows (full post rows — quotable/likeable as ever); a
 * busier span becomes ONE synthetic digest entry stamped with the newest
 * mint's time (that's where it weaves in). The digest's txid is a synthetic
 * stable key — never a real txid — so client-side dedup/React keys work
 * without colliding with a real post.
 */
function buildMintEntries(mints, mintCount) {
  if (!mints || mints.length === 0) return { inlineMints: [], digest: null }
  if (mintCount <= MINT_INLINE_MAX) return { inlineMints: mints, digest: null }

  const newest = mints[0]
  return {
    inlineMints: [],
    digest: {
      txid: `mint-digest-${newest.txid}`,
      mintDigest: true,
      count: mintCount,
      handles: mints.slice(0, MINT_INLINE_MAX).map((m) => ({
        handle: typeof m.card_meta?.handle === 'string' ? m.card_meta.handle : null,
        txid: m.txid,
      })),
      created_at: newest.created_at,
      authorIdentity: newest.author_identity ?? null,
    },
  }
}

/**
 * Turn a raw candidate window (rows ordered created_at DESC, id DESC) into the
 * served page: derive nextCursor from the RAW time order first (so paging stays
 * stable), then rank the window for display, then decorate. When the caller
 * passes the span's mint announcements (For You only), they're woven in last —
 * individual rows join the decoration pass (they need live bylines and viewer
 * reaction state like any post); a digest is synthetic and skips it.
 */
async function finalizeWindow(
  supabase,
  rows,
  pageSizeNum,
  { viewerAddress, viewerAccountId, withParents = false, attachIdentity = true, spanMints = null },
) {
  const rowsList = rows ?? []
  const full = rowsList.length === pageSizeNum
  const nextCursor = full ? encodeCursor(rowsList[rowsList.length - 1]) : null

  // spanMints may arrive as a promise so its fetch overlaps the signal RPC
  // (both depend only on the raw window). Neither ever rejects — each degrades
  // to an empty result — so awaiting in sequence here is safe.
  const [signals, spanMintsResolved] = await Promise.all([
    fetchEngagementSignals(supabase, rowsList),
    Promise.resolve(spanMints),
  ])
  const nowMs = Date.now()
  const ranked = rankFeedCandidates(rowsList, signals, nowMs)

  const { inlineMints, digest } = buildMintEntries(
    spanMintsResolved?.mints,
    spanMintsResolved?.mintCount ?? 0,
  )
  const decorated = await decoratePosts(supabase, [...ranked, ...inlineMints], {
    viewerAddress,
    viewerAccountId,
    withParents,
    attachIdentity,
  })

  if (inlineMints.length === 0 && !digest) {
    return { posts: decorated, nextCursor }
  }
  const rankedPosts = decorated.slice(0, ranked.length)
  const mintEntries = digest ? [digest] : decorated.slice(ranked.length)
  const posts = weaveMintRows(rankedPosts, mintEntries, signals, nowMs)
  return { posts, nextCursor }
}

/**
 * Newest-first page of top-level feed entries (original posts + quotes), keyset
 * paginated. Pass the previous page's `nextCursor` to fetch the next window;
 * omit it (or pass null) for the first page.
 *
 * Mint announcements (card_kind = 'handle_mint') are NOT candidates here — the
 * window is real writing only, and the span's mints ride alongside as compact
 * woven rows (see fetchSpanMintCards / weaveMintRows). They still live full-size
 * on the @proofofwriting profile, the thread page, and inside quote embeds.
 * @returns {Promise<{ posts: object[], nextCursor: string|null }>}
 */
export async function getFeedPage({ cursor = null, pageSize = 25, viewerAddress = '', viewerAccountId = null, attachIdentity = true } = {}) {
  const pageSizeNum = normalizePageSize(pageSize)
  const decoded = decodeCursor(cursor)

  const supabase = createServerSupabase()
  let query = supabase
    .from('feed_posts')
    .select(FEED_POST_COLUMNS)
    .in('action', TOP_LEVEL_ACTIONS)
    .is('deleted_at', null)
    .is('card_kind', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
  query = applyCursor(query, decoded).limit(pageSizeNum)

  const { data: rows, error } = await query
  if (error) {
    throw new Error(error.message)
  }

  // Un-awaited on purpose: finalizeWindow overlaps this fetch with the signal
  // RPC (it never rejects — errors degrade to an empty span).
  const spanMints = fetchSpanMintCards(supabase, rows ?? [], decoded)
  return finalizeWindow(supabase, rows, pageSizeNum, {
    viewerAddress,
    viewerAccountId,
    attachIdentity,
    spanMints,
  })
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
 *
 * Live IDENTITY (each byline's current @handle + chosen color) is likewise kept
 * OUT of the cached payload and resolved fresh on every read below. It's a
 * single indexed accounts lookup, and it means a handle rename or color change
 * shows up immediately across every page window instead of being frozen into the
 * 30s cache (and per-cursor entries) — which is why the same handle used to
 * render in stale vs. fresh colors at the same time.
 */
export async function getCachedForYouPage(cursor = null, pageSize = 25) {
  const pageSizeNum = normalizePageSize(pageSize)
  // The cursor is opaque and stable, so it's a safe cache-key segment: the same
  // window (same boundary) collapses to one shared render. 'start' keys the first
  // page. A malformed cursor decodes to the first page, so normalize it here too
  // to avoid caching garbage tokens as distinct keys.
  const cursorKey = decodeCursor(cursor) ? cursor : 'start'
  const page = await unstable_cache(
    () =>
      getFeedPage({
        cursor: cursorKey === 'start' ? null : cursorKey,
        pageSize: pageSizeNum,
        attachIdentity: false,
      }),
    ['feed-foryou', cursorKey, String(pageSizeNum)],
    { tags: [FEED_CACHE_TAG], revalidate: FEED_CACHE_REVALIDATE_SECONDS },
  )()
  // Resolve identity live on top of the shared cached window.
  const supabase = createServerSupabase()
  const posts = await attachLiveIdentity(supabase, page.posts)
  return { ...page, posts }
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

  // The unified timeline: followees' own posts interleaved with the posts they
  // repost, one keyset window newest-first by surfacing time (see
  // sql/feed_following_timeline.sql).
  const { data: entries, error } = await supabase.rpc('get_following_timeline', {
    follower_ids: accountIds,
    blocked_ids: [...blocked],
    before_ts: decoded?.createdAt ?? null,
    before_id: decoded?.id ?? null,
    page_size: pageSizeNum,
  })
  // Graceful degradation: if the timeline RPC is unavailable (e.g. not yet
  // applied, or a transient error), fall back to a plain chronological scan of
  // followees' own posts. Reposts simply don't resurface in this mode — the feed
  // stays correct and paginable, just without the interleave.
  if (error) {
    console.warn('[getFeed] following timeline RPC failed, falling back to chronological', error.message)
    let query = supabase
      .from('feed_posts')
      .select(FEED_POST_COLUMNS)
      .in('action', TOP_LEVEL_ACTIONS)
      .is('deleted_at', null)
      .in('author_account_id', accountIds)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
    query = applyCursor(query, decoded).limit(pageSizeNum)
    const { data: rows, error: rowsErr } = await query
    if (rowsErr) throw new Error(rowsErr.message)
    return finalizeWindow(supabase, rows, pageSizeNum, {
      viewerAddress,
      viewerAccountId: viewer,
      withParents: true,
    })
  }

  const rawEntries = entries ?? []
  // nextCursor comes off the RAW window boundary (oldest entry we fetched), BEFORE
  // dedup — so the next page resumes strictly older than everything consumed here,
  // even the duplicates we drop. Full window ⇒ there may be more.
  const full = rawEntries.length === pageSizeNum
  const last = rawEntries[rawEntries.length - 1]
  const nextCursor =
    full && last ? encodeCursor({ created_at: last.sort_ts, id: last.sort_id }) : null

  // Keep only the most-recent surfacing of each post. The stream is newest-first,
  // so the FIRST time we see a display_txid is its most recent surfacing; later
  // repeats (an older repost, or the native post under a newer repost) are dropped.
  const seen = new Set()
  const deduped = []
  for (const e of rawEntries) {
    if (!e.display_txid || seen.has(e.display_txid)) continue
    seen.add(e.display_txid)
    deduped.push(e)
  }
  if (deduped.length === 0) return { posts: [], nextCursor }

  // Hydrate the display posts (the RPC returns only pointers + surfacing metadata).
  const { data: postRows, error: postErr } = await supabase
    .from('feed_posts')
    .select(FEED_POST_COLUMNS)
    .in('txid', deduped.map((e) => e.display_txid))
  if (postErr) throw new Error(postErr.message)
  const byTxid = new Map((postRows ?? []).map((r) => [r.txid, r]))

  // Stitch each post row back to its timeline entry, preserving the RPC's order
  // and carrying the surfacing time (rank_ts, so the ranker treats a resurfaced
  // repost as fresh) and the reposter attribution.
  const rows = []
  for (const e of deduped) {
    const row = byTxid.get(e.display_txid)
    if (!row) continue
    rows.push({
      ...row,
      rank_ts: e.sort_ts,
      repostedBy:
        e.kind === 'repost'
          ? { accountId: e.reposter_account_id, identity: e.reposter_identity }
          : null,
    })
  }

  const signals = await fetchEngagementSignals(supabase, rows)
  const ranked = rankFeedCandidates(rows, signals)
  const posts = await decoratePosts(supabase, ranked, {
    viewerAddress,
    viewerAccountId: viewer,
    withParents: true,
  })
  return { posts, nextCursor }
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

/**
 * Newest-first page of REPLIES authored by ONE account — the "Replies" tab on a
 * profile page. Mirrors getAccountFeedPage but selects only replies (action 2)
 * and attaches each reply's `parent` preview so the tab can render "replying to
 * @X" context, matching how X's profile Replies tab reads.
 * @returns {Promise<{ posts: object[], nextCursor: string|null }>}
 */
export async function getAccountRepliesPage({ accountId, cursor = null, pageSize = 25, viewerAddress = '', viewerAccountId = null } = {}) {
  const account = typeof accountId === 'string' ? accountId.trim() : ''
  if (!account) return { posts: [], nextCursor: null }

  const pageSizeNum = normalizePageSize(pageSize)
  const decoded = decodeCursor(cursor)

  const supabase = createServerSupabase()

  const blocked = await blockedAccountIds(supabase, viewerAccountId)
  if (blocked.has(account)) return { posts: [], nextCursor: null }

  let query = supabase
    .from('feed_posts')
    .select(FEED_POST_COLUMNS)
    .eq('action', FEED_ACTION.REPLY)
    .is('deleted_at', null)
    .eq('author_account_id', account)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
  query = applyCursor(query, decoded).limit(pageSizeNum)

  const { data: rows, error } = await query
  if (error) throw new Error(error.message)

  return finalizeWindow(supabase, rows, pageSizeNum, {
    viewerAddress,
    viewerAccountId,
    withParents: true,
  })
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

/**
 * Minimal single-post fetch for the /feed/[txid] social-share card. Deliberately
 * lighter than getFeedThread — no replies, ancestors, reactions, or quoted/linked
 * previews — because generateMetadata (and unauthenticated social crawlers) only
 * need the post's text plus its live byline. The byline resolves the SAME way as
 * the feed (accounts.display_handle -> @handle, else the raw address), so the
 * shared card agrees with what readers see in-app. Returns null for a missing
 * post; `content` is null for a soft-deleted post so the caller can fall back to
 * the site card. Request-cached so generateMetadata + render share one query.
 */
export const getFeedPostForCard = cache(async (rawTxid) => {
  const txid = typeof rawTxid === 'string' ? rawTxid.trim().toLowerCase() : ''
  if (!/^[0-9a-f]{64}$/.test(txid)) return null

  const supabase = createServerSupabase()
  const { data: row } = await supabase
    .from('feed_posts')
    .select(
      'txid, action, content, deleted_at, author_account_id, payer_address, author_identity',
    )
    .eq('txid', txid)
    .maybeSingle()
  if (!row) return null

  const deleted = row.deleted_at != null
  const handleMap = row.author_account_id
    ? await displayHandlesByAccountId([row.author_account_id], supabase)
    : {}
  const entry = row.author_account_id ? handleMap[row.author_account_id] : null
  const handle = entry?.handle ?? null
  const displayIdentity = handle
    ? `@${handle}`
    : row.payer_address || row.author_identity || ''

  return {
    txid: row.txid,
    action: row.action,
    content: deleted ? null : row.content,
    deleted,
    handle,
    displayIdentity,
  }
})
