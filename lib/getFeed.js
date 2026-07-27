import { cache } from 'react'
import { unstable_cache } from 'next/cache'
import { createServerSupabase } from '@/lib/supabase-server'
import { FEED_ACTION } from '@/lib/feedProtocol'
import { extractArticleSlug } from '@/lib/articleLinks'
import { extractFeedPostTxid } from '@/lib/contentLinks'
import { displayHandlesByAccountId, displayHandlesByAuthorId } from '@/lib/authorDisplayHandles'
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
// span's mints are summarized into ONE digest row per page span and woven back
// in. Each page's span is disjoint from its neighbours' (page N excludes its
// boundary, page N+1 includes it), so every mint is counted in exactly one
// digest — no double-counting across pages.
// How many handles a digest names before collapsing the rest into "+N others".
const MINT_NAMED_MAX = 3
// Fetch cap for a page span's mint rows. Mints are bucketed per gap (between
// adjacent posts) into their OWN small digest, so we fetch the actual rows (not
// just a total) — generous enough to cover a burst; an extreme span past this
// merely undercounts the oldest gap.
const MINT_SPAN_FETCH_LIMIT = 300

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
 * Mark whether the given viewer has already liked/reposted each post.
 * Counts themselves come denormalized on the row (see toClientPost); this only
 * resolves the viewer's OWN reactions, which can't be denormalized per-post.
 * Reactions live in feed_events keyed by target_txid; likes are action 5,
 * reposts action 4. Matched by ACCOUNT when known — a like paid from any
 * linked wallet (e.g. the Pocket) still reads as the viewer's — with
 * payer_address as the legacy fallback for rows that predate account
 * resolution. No viewer at all → everything false.
 */
async function attachViewerReactions(supabase, posts, viewerAddress = '', viewerAccountId = null) {
  const withDefaults = posts.map((p) => ({
    ...p,
    likedByViewer: false,
    repostedByViewer: false,
  }))
  const addr = typeof viewerAddress === 'string' ? viewerAddress.trim() : ''
  const acctId = typeof viewerAccountId === 'string' ? viewerAccountId.trim() : ''
  const txids = withDefaults.map((p) => p.txid).filter(Boolean)
  if ((!addr && !acctId) || txids.length === 0) return withDefaults

  // PostgREST .or() grammar: conditions split on commas, value = remainder
  // after the second dot. Addresses contain a colon (ecash:) — quote the value
  // so it can never be misparsed.
  const clauses = []
  if (acctId) clauses.push(`actor_account_id.eq.${acctId}`)
  if (addr) clauses.push(`payer_address.eq."${addr}"`)

  const likedByViewer = new Set()
  const repostedByViewer = new Set()
  const { data: mine } = await supabase
    .from('feed_events')
    .select('target_txid, action')
    .or(clauses.join(','))
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
 * For TOP-LEVEL posts in a timeline that doesn't carry reply rows (For You),
 * attach ONE reply as `post.topReply` — the conversation teaser.
 *
 * WHY NOT REPLY ROWS IN FOR YOU. Replies are already a ranking signal for their
 * parent (a paid reply is breadth — see sql/feed_engagement_signal.sql), so
 * giving a reply its own slot would count one conversation twice. And discussion
 * here is concentrated, not spread: most posts draw no reply at all, while a
 * live one draws a dozen — so reply rows would let a single thread take over a
 * page. Hanging the best reply UNDER its parent shows the conversation exists
 * without adding rows, without the double-count, and without the flood.
 *
 * WHICH REPLY. The highest-paid reply BY SOMEONE OTHER THAN the post's author:
 * money is this site's engagement signal, and a self-reply is a thread
 * continuation, not a conversation (it would also let an author manufacture the
 * teaser on their own post). No one else replied ⇒ no teaser.
 */
export function pickTopReply(replies, parentAuthorAccountId) {
  let best = null
  for (const r of replies ?? []) {
    if (!r) continue
    // A self-reply is a thread continuation, not a conversation — and letting it
    // win would mean an author can mint their own teaser by replying to
    // themselves with a big payment.
    if (r.author_account_id && r.author_account_id === parentAuthorAccountId) continue
    if (best == null) {
      best = r
      continue
    }
    const amt = Number(r.amount_sats ?? 0)
    const bestAmt = Number(best.amount_sats ?? 0)
    if (amt > bestAmt) best = r
    // Equal spend ⇒ the newer reply wins, so a live thread shows its current
    // state rather than freezing on whoever got there first.
    else if (amt === bestAmt && Date.parse(r.created_at ?? 0) > Date.parse(best.created_at ?? 0)) {
      best = r
    }
  }
  return best
}

async function attachTopReply(supabase, posts) {
  const parentTxids = [
    ...new Set(
      posts
        .filter((p) => p.action !== FEED_ACTION.REPLY && p.txid && (p.replyCount ?? 0) > 0)
        .map((p) => p.txid),
    ),
  ]
  if (parentTxids.length === 0) return posts.map((p) => ({ ...p, topReply: null }))

  // Ordered highest-paid first so the cap keeps the candidates that can actually
  // win. The cap is a runaway backstop, not a real bound: it's one page of
  // parents, and only a small fraction of posts are replied to at all.
  const { data: rows } = await supabase
    .from('feed_posts')
    .select(FEED_POST_COLUMNS)
    .eq('action', FEED_ACTION.REPLY)
    .in('parent_txid', parentTxids)
    .is('deleted_at', null)
    .order('amount_sats', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(300)

  const byParent = new Map()
  for (const r of rows ?? []) {
    const list = byParent.get(r.parent_txid)
    if (list) list.push(r)
    else byParent.set(r.parent_txid, [r])
  }

  return posts.map((p) => {
    const winner = p.txid ? pickTopReply(byParent.get(p.txid), p.author_account_id) : null
    return { ...p, topReply: winner ? toClientPost(winner) : null }
  })
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
    .select('slug, title, teaser, price_xec, reading_time_minutes, author_id, authors(username)')
    .in('slug', slugs)
    .eq('published', true)
    .eq('legacy', false)

  // Byline follows the author's CURRENT handle (accounts.display_handle), not the
  // frozen authors.username — otherwise an author who has since rebound their
  // handle (e.g. @founder -> @beep) keeps showing the old name on the card. This
  // is the same live source the article page itself uses; username is only the
  // fallback for authors who never bound a handle.
  const handleMap = await displayHandlesByAuthorId(
    (rows ?? []).map((r) => r.author_id),
    supabase,
  )

  const bySlug = {}
  for (const r of rows ?? []) {
    const author = Array.isArray(r.authors) ? r.authors[0] : r.authors
    bySlug[r.slug] = {
      slug: r.slug,
      title: r.title ?? '',
      teaser: r.teaser ?? '',
      priceXec: r.price_xec ?? null,
      readingTimeMinutes: r.reading_time_minutes ?? null,
      author: handleMap[r.author_id]?.handle ?? author?.username ?? null,
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
    if (p.topReply?.author_account_id) accountIds.push(p.topReply.author_account_id)
    if (p.linkedPost?.author_account_id) accountIds.push(p.linkedPost.author_account_id)
    // The reposter's byline ("Reposted by @X") is resolved live too.
    if (p.repostedBy?.accountId) accountIds.push(p.repostedBy.accountId)
  }
  // Live handle + the account's CURRENT primary address, resolved together. The
  // no-handle byline is the account's PRIMARY wallet address — never the raw
  // payer (a Pocket payment's payer is the linked, non-primary pocket address)
  // and never the frozen author_identity (which can be a handle the account has
  // since sold). Frozen snapshot / payer are last-resort fallbacks only.
  const uniqueIds = [...new Set(accountIds)]
  const [handleMap, primaryByAccount] = await Promise.all([
    displayHandlesByAccountId(uniqueIds, supabase),
    (async () => {
      const map = new Map()
      if (uniqueIds.length === 0) return map
      const { data } = await supabase
        .from('account_addresses')
        .select('account_id, address')
        .in('account_id', uniqueIds)
        .eq('is_primary', true)
      for (const r of data ?? []) if (!map.has(r.account_id)) map.set(r.account_id, r.address)
      return map
    })(),
  ])

  const entryFor = (row) =>
    row?.author_account_id ? handleMap[row.author_account_id] : null

  const identityFor = (row) => {
    if (!row) return row
    const entry = entryFor(row)
    if (entry?.handle) return `@${entry.handle}`
    return (
      (row.author_account_id && primaryByAccount.get(row.author_account_id)) ||
      row.author_identity ||
      row.payer_address
    )
  }
  // Only a live "@handle" byline carries a custom color; address fallbacks don't.
  const colorFor = (row) => (row ? entryFor(row)?.color ?? null : null)
  // AI-operated poster (authors.is_ai) -> the byline wears the [AI] label.
  const isAiFor = (row) => (row ? entryFor(row)?.isAi === true : false)

  const withIdentity = (row) =>
    row
      ? {
          ...row,
          displayIdentity: identityFor(row),
          displayColor: colorFor(row),
          displayIsAi: isAiFor(row),
        }
      : row

  // Resolve a repost attribution's live display identity from the reposter's
  // current handle (falling back to the frozen snapshot from write time).
  const repostedByFor = (row) => {
    const rb = row?.repostedBy
    if (!rb?.accountId) return rb ?? null
    const entry = handleMap[rb.accountId]
    return {
      ...rb,
      identity: entry?.handle
        ? `@${entry.handle}`
        : primaryByAccount.get(rb.accountId) || rb.identity || null,
      color: entry?.color ?? null,
    }
  }

  return posts.map((p) => ({
    ...p,
    displayIdentity: identityFor(p),
    displayColor: colorFor(p),
    displayIsAi: isAiFor(p),
    quoted: withIdentity(p.quoted),
    parent: withIdentity(p.parent),
    topReply: p.topReply !== undefined ? withIdentity(p.topReply) : undefined,
    linkedPost: p.linkedPost !== undefined ? withIdentity(p.linkedPost) : undefined,
    repostedBy: repostedByFor(p),
  }))
}

/** Shape + enrich a batch of raw feed_posts rows for the client. `withParents`
 *  adds the `post.parent` preview for replies (timelines that surface replies —
 *  the Following feed and the profile "Replies" tab — pass it; the profile
 *  "Posts" tab doesn't, since it never includes replies). `withTopReply` adds the
 *  conversation teaser under top-level posts — the mirror image, for the one
 *  timeline that carries no reply rows of its own (For You). */
async function decoratePosts(
  supabase,
  rows,
  {
    viewerAddress = '',
    viewerAccountId = null,
    withParents = false,
    withTopReply = false,
    attachIdentity = true,
  } = {},
) {
  const shaped = (rows ?? []).map(toClientPost)

  // The seven attach steps below are mutually independent: each reads only RAW
  // row fields (txid / quoted_txid / parent_txid / author_account_id / content /
  // deleted) and adds its own disjoint keys — none consumes another's output. So
  // they run over the same window concurrently instead of as seven serial DB
  // round-trips. Only attachLiveIdentity (last) depends on earlier outputs: it
  // resolves bylines for the attached quoted/parent/topReply/linkedPost previews.
  const [withReactions, withQuoted, withParent, withFollow, withCards, withLinked, withTop] =
    await Promise.all([
      attachViewerReactions(supabase, shaped, viewerAddress, viewerAccountId),
      attachQuoted(supabase, shaped),
      withParents ? attachParentPreview(supabase, shaped) : Promise.resolve(null),
      attachFollowState(supabase, shaped, viewerAccountId),
      attachArticleCards(supabase, shaped),
      attachLinkedPosts(supabase, shaped),
      withTopReply ? attachTopReply(supabase, shaped) : Promise.resolve(null),
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
    if (withTop) copyAdded(out, withTop[i], p)
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
    .select('txid, created_at, card_meta')
    .eq('card_kind', 'handle_mint')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(MINT_SPAN_FETCH_LIMIT)
  if (decoded?.createdAt) query = query.lte('created_at', decoded.createdAt)
  const oldest = rowsList[rowsList.length - 1]
  if (oldest?.created_at) query = query.gt('created_at', oldest.created_at)

  const { data, error } = await query
  if (error) {
    console.error('[getFeed] span mint fetch failed', error.message)
    return { mints: [] }
  }
  return { mints: data ?? [] }
}

/**
 * Bucket a page span's mints into one small digest PER GAP between adjacent
 * posts, instead of one giant digest for the whole page. A mint's gap is decided
 * by how many real posts are newer than it (posts are newest-first), so every
 * mint lands in exactly one gap — no double-counting — and each digest counts
 * only the mints that happened in that stretch of the timeline (a believable,
 * local number). Each digest names up to MINT_NAMED_MAX handles and collapses
 * the rest into "and N others"; its created_at is the newest mint in the gap, so
 * weaveMintRows drops it right there. Synthetic txid = a stable, non-real key.
 *
 * @param {object[]} mints   span mint rows (newest-first): { txid, created_at, card_meta }
 * @param {object[]} posts   the raw real posts of the page (newest-first) — the gap boundaries
 */
function buildMintDigests(mints, posts) {
  if (!mints || mints.length === 0) return []
  const postTimes = (posts ?? [])
    .map((p) => new Date(p.created_at).getTime())
    .filter((t) => Number.isFinite(t))
  // posts are newest-first, so "posts newer than this mint" is a leading run.
  const gapIndex = (t) => {
    let n = 0
    for (const pt of postTimes) {
      if (pt > t) n++
      else break
    }
    return n
  }

  const groups = new Map()
  for (const m of mints) {
    const t = new Date(m.created_at).getTime()
    const g = gapIndex(Number.isFinite(t) ? t : 0)
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g).push(m)
  }

  const digests = []
  for (const group of groups.values()) {
    const newest = group[0] // group inherits the mints' newest-first order
    const named = group
      .map((m) => (typeof m.card_meta?.handle === 'string' ? { handle: m.card_meta.handle, txid: m.txid } : null))
      .filter(Boolean)
      .slice(0, MINT_NAMED_MAX)
    digests.push({
      txid: `mint-digest-${newest.txid}`,
      mintDigest: true,
      count: group.length,
      named,
      others: Math.max(0, group.length - named.length),
      created_at: newest.created_at,
    })
  }
  return digests
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
  {
    viewerAddress,
    viewerAccountId,
    withParents = false,
    withTopReply = false,
    attachIdentity = true,
    spanMints = null,
  },
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

  // Bucket span mints into per-gap digests, keyed on the RAW chronological posts
  // (rowsList is newest-first) so counts reflect real time windows.
  const digests = buildMintDigests(spanMintsResolved?.mints, rowsList)
  const decorated = await decoratePosts(supabase, ranked, {
    viewerAddress,
    viewerAccountId,
    withParents,
    withTopReply,
    attachIdentity,
  })

  if (digests.length === 0) {
    return { posts: decorated, nextCursor }
  }
  const posts = weaveMintRows(decorated, digests, signals, nowMs)
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
    // Only MINT cards are held out of the window (they ride the woven digest);
    // poll cards ARE real posts and rank inline like any other.
    .or('card_kind.is.null,card_kind.eq.poll')
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
    // For You carries no reply ROWS, so each post brings its best reply with it.
    withTopReply: true,
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
  // No handle: the account's PRIMARY wallet address, never the raw payer (a
  // Pocket payment's payer is the linked, non-primary pocket address).
  let primaryAddr = null
  if (!handle && row.author_account_id) {
    const { data: primary } = await supabase
      .from('account_addresses')
      .select('address')
      .eq('account_id', row.author_account_id)
      .eq('is_primary', true)
      .limit(1)
      .maybeSingle()
    primaryAddr = primary?.address ?? null
  }
  const displayIdentity = handle
    ? `@${handle}`
    : primaryAddr || row.author_identity || row.payer_address || ''

  // The AI-simulation label on the share card must never depend on a handle
  // being bound (the handle map skips handle-less accounts), so when the map
  // misses, resolve authors.is_ai off the account link directly.
  let isAi = entry?.isAi === true
  if (!entry && row.author_account_id) {
    const { data: acct } = await supabase
      .from('accounts')
      .select('authors(is_ai)')
      .eq('id', row.author_account_id)
      .maybeSingle()
    const author = Array.isArray(acct?.authors) ? acct.authors[0] : acct?.authors
    isAi = author?.is_ai === true
  }

  return {
    txid: row.txid,
    action: row.action,
    content: deleted ? null : row.content,
    deleted,
    handle,
    displayIdentity,
    isAi,
  }
})
