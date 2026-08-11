// =============================================================================
//  app/api/activity/route.ts — the truthful firehose behind the desktop rail.
//
//  One merged, newest-first stream of every VERIFIED economic event the
//  platform records: feed posts/replies/quotes, likes & tips, reposts,
//  article unlocks, article publishes, and handle mints. Every item carries
//  its on-chain txid so the rail can link each line to the explorer — the
//  whole point is that this is auditable activity, not engagement theater.
//
//  The DB renders, the chain nudges: rows here exist only after the server
//  verified the payment (and its POWR envelope where applicable), so nothing
//  unverified can appear. The client's LOKAD websocket subscription is only
//  a doorbell that triggers a refetch of this endpoint.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/db";
import { priceForHandle } from "@/lib/handlePricing";
import { displayHandlesByAccountId } from "@/lib/authorDisplayHandles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabase = adminDb();

// A plain like is the 100 XEC floor; anything above it is a tip.
const LIKE_FLOOR_SATS = 10_000;

const PER_SOURCE = 30;
const MAX_ITEMS = 48;

export type ActivityItem = {
  id: string;
  kind:
    | "post" | "reply" | "quote"
    | "like" | "tip" | "repost"
    | "unlock" | "publish" | "mint" | "comment" | "comment_like";
  /** Frozen display byline: "@handle" or a raw eCash address. */
  actor: string;
  /** The actor's chosen handle color (--hc), when they show a @handle. Null for
   *  address / placeholder bylines — the rail tints only a live handle. */
  color?: string | null;
  /** Link to the actor's profile ("/@handle" or "/a/<address>"), or null for
   *  placeholder bylines ("a reader", "an author") that have no profile. */
  actorHref: string | null;
  /** The actor's ACCOUNT id, when known — lets the client drop rows from accounts
   *  the viewer has blocked (the neutral, cached firehose can't filter per-viewer;
   *  ActivityRail does it in an overlay, like the feed's viewer-state). Null for
   *  rows with no resolvable account (mints, stray-wallet unlocks). */
  actorAccountId: string | null;
  /** For rows whose `target` quotes ANOTHER post's content (a repost/like/tip of
   *  a post), the account that authored that target — so the client also hides a
   *  row that surfaces a blocked account's content even when the actor isn't
   *  blocked (e.g. a repost of a blocked account's post). Null otherwise. */
  targetAccountId?: string | null;
  /** Who/what the action touched: a post author byline, article title, or handle. */
  target: string | null;
  amountXec: number | null;
  at: string;
  href: string;
  /** For article rows (unlock/publish/comment/comment_like): the post slug, so a
   *  host with a reading pane (the home feed) can open it in place instead of
   *  navigating. Absent on feed-thread, mint and profile rows. Legacy vs current
   *  is resolved by slug alone in the reader route, so no legacy flag is needed. */
  slug?: string | null;
  txid: string | null;
};

const snippet = (s: unknown, n = 56) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

// Merge rows from two queries (inbound + outbound of the same kind) by txid,
// keeping first-seen order; txid-less rows are dropped (nothing to link/key on).
function dedupeByTxid<T extends { txid: string | null }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    if (!r.txid || seen.has(r.txid)) return false;
    seen.add(r.txid);
    return true;
  });
}

const bare = (address: string) => address.replace(/^ecash:/, "").toLowerCase();
const shortAddr = (address: string) => {
  const b = bare(address);
  return `${b.slice(0, 8)}…${b.slice(-4)}`;
};

// Legacy (imported) articles live at the root `/<slug>`, not `/posts/<slug>` —
// mirrors the profile ArticleRow rule so unlock/publish links don't 404.
const articleHref = (slug: string, legacy?: boolean | null) =>
  legacy ? `/${encodeURIComponent(slug)}` : `/posts/${encodeURIComponent(slug)}`;

// Identity snapshots are "@handle" or a raw eCash address; addresses get the
// same truncation the rest of the UI uses so the rail stays scannable.
const displayIdentity = (identity: string | null | undefined, fallback: string) => {
  const id = String(identity ?? "").trim();
  if (!id) return fallback;
  return id.startsWith("@") ? id : shortAddr(id);
};

// Profile link for an actor. Both handles and raw addresses are served under
// /@<identifier> (next.config rewrites /@:id → /profile/:id, which resolves a
// handle to its current on-chain holder or a bare eCash address to that
// account). Placeholder bylines / anything unrecognized → null (plain text).
const profileHref = (rawIdentity: string | null | undefined): string | null => {
  const id = String(rawIdentity ?? "").trim();
  if (!id) return null;
  if (id.startsWith("@")) return `/@${encodeURIComponent(id.slice(1))}`;
  const b = id.toLowerCase().replace(/^ecash:/, "");
  return /^[a-z0-9]{42}$/.test(b) ? `/@${b}` : null;
};

// Thin wrapper so a transient failure in any of the ~10 source queries returns a
// clean { ok: false } instead of an unhandled throw (an opaque 500 whose body the
// client can't even parse). The rail treats !ok as a failure and fast-retries, so
// a DB blip / cold-start self-heals in seconds instead of hanging on "Listening…".
export async function GET(req: NextRequest) {
  try {
    return await buildActivity(req);
  } catch (e) {
    console.error("[activity] failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: "activity_unavailable" }, { status: 500 });
  }
}

async function buildActivity(req: NextRequest) {
  // Optional author scoping (profile pages): ?authorId=<uuid>&address=<ecash>
  // narrows the stream to one author's economy — their feed posts, value
  // received on their content, and their articles' unlocks/publishes. Mints
  // aren't attributable to an author (the handles table has no owner column),
  // so that source is skipped when scoped.
  const sp = req.nextUrl.searchParams;
  const authorIdRaw = (sp.get("authorId") ?? "").trim();
  const authorId = /^[0-9a-f-]{36}$/i.test(authorIdRaw) ? authorIdRaw : null;
  const addressRaw = (sp.get("address") ?? "").trim().toLowerCase().replace(/^ecash:/, "");
  const address = /^[a-z0-9]{42}$/.test(addressRaw) ? addressRaw : null;
  const scoped = Boolean(authorId || address);
  const addressForms = address ? [address, `ecash:${address}`] : [];

  // The scoped feed_posts filter needs the address's ACCOUNT (posts are keyed
  // by author_account_id, not payout address).
  let scopedAccountId: string | null = null;
  if (address) {
    const { data: links } = await supabase
      .from("account_addresses")
      .select("account_id")
      .in("address", addressForms)
      .limit(1);
    scopedAccountId = (links?.[0]?.account_id as string | undefined) ?? null;
  }

  // All of this account's linked wallet addresses (primary + pocket + old ones
  // after an address change). Outbound value — an unlock or mint the author PAID
  // — can come from any of them (a Pocket payment's payer is a linked, non-primary
  // address), so matching on the single passed address would miss those.
  let authorAddressForms = addressForms;
  if (scopedAccountId) {
    const { data: addrs } = await supabase
      .from("account_addresses")
      .select("address")
      .eq("account_id", scopedAccountId);
    const bares = [
      ...new Set(((addrs ?? []) as Array<{ address: string }>).map((a) => bare(a.address))),
    ];
    if (bares.length > 0) authorAddressForms = bares.flatMap((b) => [b, `ecash:${b}`]);
  }

  let postsQuery = supabase
    .from("feed_posts")
    .select("txid, action, author_account_id, author_identity, payer_address, amount_sats, content, created_at, card_kind")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(PER_SOURCE);
  if (scoped) {
    postsQuery = scopedAccountId
      ? postsQuery.eq("author_account_id", scopedAccountId)
      : postsQuery.eq("author_account_id", "00000000-0000-0000-0000-000000000000"); // no account → no feed posts
  }

  // Reposts only (action 4). Neither rail shows likes or tips any more, and likes
  // are ~80% of this table — fetching them would spend the PER_SOURCE budget on
  // rows that get discarded, starving the rail of what it does show.
  let eventsQuery = supabase
    .from("feed_events")
    .select("txid, action, actor_account_id, actor_identity, payer_address, amount_sats, target_txid, created_at")
    .eq("action", 4)
    .order("created_at", { ascending: false })
    .limit(PER_SOURCE);
  if (scoped) {
    // payout_address = who the reaction PAID, i.e. the author of the target
    // post — exactly "value this author received".
    eventsQuery = addressForms.length > 0
      ? eventsQuery.in("payout_address", addressForms)
      : eventsQuery.eq("txid", "-"); // unmatchable → empty source
  }

  // Unlocks are a SCOPED-only source now: the global rail no longer shows them,
  // so it shouldn't pay for the query (the builder is lazy — never awaited on the
  // unscoped path, so no request goes out). A profile's economy rail still needs
  // them: those are the author's sales.
  const unlocksBase = supabase
    .from("unlocks")
    .select("txid, payer_address, unlocked_at, posts!inner(title, slug, price_xec, author_id, legacy)")
    .order("unlocked_at", { ascending: false })
    .limit(PER_SOURCE);
  const unlocksQuery = !scoped
    ? Promise.resolve({ data: [] as Array<never> })
    : authorId
      ? unlocksBase.eq("posts.author_id", authorId)
      : unlocksBase.eq("txid", "-");

  let publishesQuery = supabase
    .from("publishes")
    .select("txid, amount_sats, paid_at, author_id, posts(title, slug, legacy)")
    .order("paid_at", { ascending: false })
    .limit(PER_SOURCE);
  if (scoped) {
    publishesQuery = authorId
      ? publishesQuery.eq("author_id", authorId)
      : publishesQuery.eq("txid", "-");
  }

  // Scoped-only symmetric sources. The base queries above capture value IN (their
  // articles' unlocks, reactions paid to them) and their posts; these add the
  // mirror image: value they SENT and their own article engagement.
  //  - outbound unlocks: articles THEY unlocked (payer = one of their addresses)
  //  - comments: on their articles (inbound) + ones they wrote (outbound)
  //  - mints: handles they minted — the mint feed card is authored by the official
  //    mint account, so attribution rides card_meta.minterAddress, not the author.
  const outboundUnlocksQuery =
    scoped && authorAddressForms.length > 0
      ? supabase
          .from("unlocks")
          .select("txid, payer_address, unlocked_at, posts!inner(title, slug, price_xec, author_id, legacy)")
          .in("payer_address", authorAddressForms)
          .order("unlocked_at", { ascending: false })
          .limit(PER_SOURCE)
      : Promise.resolve({ data: [] as Array<never> });

  // Comments never select `content` (paywalled) — the rail references the article.
  const inboundCommentsQuery =
    scoped && authorId
      ? supabase
          .from("comments")
          .select("txid, author_account_id, author_identity, payer_address, amount_sats, created_at, posts!inner(title, slug, legacy, author_id)")
          .is("deleted_at", null)
          .not("txid", "is", null)
          .eq("posts.author_id", authorId)
          .order("created_at", { ascending: false })
          .limit(PER_SOURCE)
      : Promise.resolve({ data: [] as Array<never> });
  const outboundCommentsQuery =
    scoped && scopedAccountId
      ? supabase
          .from("comments")
          .select("txid, author_account_id, author_identity, payer_address, amount_sats, created_at, posts!inner(title, slug, legacy)")
          .is("deleted_at", null)
          .not("txid", "is", null)
          .eq("author_account_id", scopedAccountId)
          .order("created_at", { ascending: false })
          .limit(PER_SOURCE)
      : Promise.resolve({ data: [] as Array<never> });

  const scopedMintsQuery =
    scoped && authorAddressForms.length > 0
      ? supabase
          .from("feed_posts")
          .select("txid, card_meta, created_at")
          .eq("card_kind", "handle_mint")
          .is("deleted_at", null)
          .in("card_meta->>minterAddress", authorAddressForms)
          .order("created_at", { ascending: false })
          .limit(PER_SOURCE)
      : Promise.resolve({ data: [] as Array<never> });

  // Paid LIKES on article comments (comment_events). Site-wide firehose; scoped =
  // likes RECEIVED on the author's comments (inbound, payout_address) + likes they
  // GAVE (outbound, actor). References the ARTICLE title, never the paywalled body.
  // Comment likes are retired from BOTH rails (neither shows likes now), so all
  // three comment_events sources resolve empty and no query is issued. Kept as
  // named empties so the Promise.all destructuring below is unchanged, and so
  // re-enabling is restoring a query rather than rebuilding the plumbing.
  const commentLikesQuery = Promise.resolve({ data: [] as Array<never> });
  const inboundCommentLikesQuery = Promise.resolve({ data: [] as Array<never> });
  const outboundCommentLikesQuery = Promise.resolve({ data: [] as Array<never> });

  const [
    postsQ, eventsQ, unlocksQ, publishesQ, mintsQ, commentsQ, ownReactionsQ,
    outUnlocksQ, inCommentsQ, outCommentsQ, scopedMintsQ,
    commentLikesQ, inCommentLikesQ, outCommentLikesQ,
  ] = await Promise.all([
    postsQuery,
    eventsQuery,
    unlocksQuery,
    publishesQuery,
    scoped
      ? Promise.resolve({ data: [] as Array<never> })
      : supabase
          .from("handles")
          .select("token_id, handle, tier, created_at")
          .order("created_at", { ascending: false })
          .limit(PER_SOURCE),
    // Paid article comments + replies. Only on-chain ones (txid present) — a
    // legacy free comment has no payment to show. Site-wide firehose only.
    scoped
      ? Promise.resolve({ data: [] as Array<never> })
      : supabase
          // NB: comment `content` is NEVER selected here. Article comments are
          // paywalled — visible only to readers who unlocked the article — so
          // the public firehose references the ARTICLE (title), never the
          // comment body. The rail says "commented on <Title>", not the text.
          .from("comments")
          .select("txid, author_account_id, author_identity, payer_address, amount_sats, created_at, posts!inner(title, slug, legacy)")
          .is("deleted_at", null)
          .not("txid", "is", null)
          .order("created_at", { ascending: false })
          .limit(PER_SOURCE),
    // Scoped only: the author's OWN reposts (action 4 — their likes and tips are
    // no longer shown). The main events query returns reactions the author
    // RECEIVED (payout_address = them); without this, an author who reposts but
    // hasn't been reposted back shows none of their own engagement — even though
    // their replies and quotes already appear (those are stored as feed_posts).
    // Merged + de-duped into `events` below.
    scoped && scopedAccountId
      ? supabase
          .from("feed_events")
          .select("txid, action, actor_account_id, actor_identity, payer_address, amount_sats, target_txid, created_at")
          .eq("actor_account_id", scopedAccountId)
          .eq("action", 4)
          .order("created_at", { ascending: false })
          .limit(PER_SOURCE)
      : Promise.resolve({ data: [] as Array<never> }),
    outboundUnlocksQuery,
    inboundCommentsQuery,
    outboundCommentsQuery,
    scopedMintsQuery,
    commentLikesQuery,
    inboundCommentLikesQuery,
    outboundCommentLikesQuery,
  ]);

  const items: ActivityItem[] = [];

  // ---- row shapes for the DB-backed sources whose bylines resolve live ----
  type PostRow = {
    txid: string; action: number; author_account_id: string | null;
    author_identity: string | null; payer_address: string | null;
    amount_sats: number | null; content: string | null; created_at: string;
    card_kind: string | null;
  };
  type EventRow = {
    txid: string; action: number; actor_account_id: string | null;
    actor_identity: string | null; payer_address: string | null;
    amount_sats: number | null; target_txid: string | null; created_at: string;
  };
  type CommentRow = {
    txid: string; author_account_id: string | null; author_identity: string | null;
    payer_address: string | null; amount_sats: number | null;
    created_at: string;
    posts: { title: string | null; slug: string | null; legacy?: boolean | null } | null;
  };
  const posts = (postsQ.data ?? []) as PostRow[];
  // Site-wide: the firehose comment query. Scoped: comments ON their articles
  // (inbound) + comments they WROTE (outbound), merged and de-duped by txid.
  const comments = scoped
    ? dedupeByTxid([
        ...((inCommentsQ.data ?? []) as unknown as CommentRow[]),
        ...((outCommentsQ.data ?? []) as unknown as CommentRow[]),
      ])
    : ((commentsQ.data ?? []) as unknown as CommentRow[]);
  // Comment likes: site-wide firehose, or (scoped) received + given, de-duped.
  type CommentLikeRow = {
    txid: string; target_txid: string; actor_account_id: string | null;
    actor_identity: string | null; payer_address: string | null;
    amount_sats: number | null; created_at: string;
  };
  const commentLikes = scoped
    ? dedupeByTxid([
        ...((inCommentLikesQ.data ?? []) as unknown as CommentLikeRow[]),
        ...((outCommentLikesQ.data ?? []) as unknown as CommentLikeRow[]),
      ])
    : ((commentLikesQ.data ?? []) as unknown as CommentLikeRow[]);
  // Reactions the author received + (scoped) their own likes/tips/reposts,
  // de-duped by txid — the final items.sort() below orders the merged stream.
  const seenEventTxids = new Set<string>();
  const events = [
    ...((eventsQ.data ?? []) as EventRow[]),
    ...((ownReactionsQ.data ?? []) as EventRow[]),
  ].filter((e) => {
    if (!e.txid || seenEventTxids.has(e.txid)) return false;
    seenEventTxids.add(e.txid);
    return true;
  });

  // ---- resolve the liked/reposted target posts: their CONTENT is what a
  //      like/repost line references ("liked '…the post…'"), with the author
  //      byline as a fallback for a text-less card (e.g. an image). ----
  type TargetInfo = {
    authorAccountId: string | null; authorIdentity: string | null;
    payerAddress: string | null; content: string | null;
  };
  const targetTxids = [...new Set(events.map((e) => e.target_txid).filter(Boolean))] as string[];
  const targetInfo = new Map<string, TargetInfo>();
  if (targetTxids.length > 0) {
    const { data: targets } = await supabase
      .from("feed_posts")
      .select("txid, author_account_id, author_identity, payer_address, content")
      .in("txid", targetTxids);
    for (const t of (targets ?? []) as Array<{
      txid: string; author_account_id: string | null; author_identity: string | null;
      payer_address: string | null; content: string | null;
    }>) {
      targetInfo.set(t.txid, {
        authorAccountId: t.author_account_id,
        authorIdentity: t.author_identity,
        payerAddress: t.payer_address,
        content: t.content,
      });
    }
  }

  // ---- resolve each liked COMMENT's txid to its ARTICLE (title + slug), so a
  //      comment-like line reads "liked a comment on <Title>" and links to
  //      #comments. The comment BODY is never touched — it's paywalled, exactly
  //      like the `comments` source above references the article, not the text. ----
  type CommentArticle = { title: string | null; slug: string | null; legacy?: boolean | null };
  const clCommentTxids = [
    ...new Set(commentLikes.map((e) => e.target_txid).filter(Boolean)),
  ] as string[];
  const clArticleByComment = new Map<string, CommentArticle>();
  if (clCommentTxids.length > 0) {
    const { data: cmts } = await supabase
      .from("comments")
      .select("txid, posts!inner(title, slug, legacy)")
      .in("txid", clCommentTxids);
    for (const c of (cmts ?? []) as Array<{ txid: string; posts: CommentArticle | CommentArticle[] | null }>) {
      const cp = Array.isArray(c.posts) ? c.posts[0] : c.posts;
      if (cp?.slug) clArticleByComment.set(c.txid, cp);
    }
  }

  // ---- bylines resolve LIVE from each poster's CURRENT account handle, exactly
  //      like the feed/profile/post-detail (lib/getFeed.js attachLiveIdentity,
  //      via the same displayHandlesByAccountId helper). The frozen
  //      author_identity/actor_identity is only the last-resort fallback, so a
  //      handle an account has since sold or unbound stops appearing on its old
  //      activity here — otherwise the rail links to the wrong profile. ----
  const bylineAccountIds = [
    ...posts.map((p) => p.author_account_id),
    ...events.map((e) => e.actor_account_id),
    ...[...targetInfo.values()].map((t) => t.authorAccountId),
    ...comments.map((c) => c.author_account_id),
    ...commentLikes.map((e) => e.actor_account_id),
  ].filter(Boolean) as string[];
  const uniqueBylineIds = [...new Set(bylineAccountIds)];
  // Live handle + the account's CURRENT primary address. The no-handle byline is
  // the account's PRIMARY wallet address — never the raw payer (a Pocket
  // payment's payer is the linked, non-primary pocket address) and never the
  // frozen snapshot (which can be a handle the account has since sold).
  const [handleMap, primaryByAccount] = await Promise.all([
    displayHandlesByAccountId(uniqueBylineIds, supabase),
    (async () => {
      const map = new Map<string, string>();
      if (uniqueBylineIds.length === 0) return map;
      const { data } = await supabase
        .from("account_addresses")
        .select("account_id, address")
        .in("account_id", uniqueBylineIds)
        .eq("is_primary", true);
      for (const r of (data ?? []) as Array<{ account_id: string; address: string }>) {
        if (!map.has(r.account_id)) map.set(r.account_id, r.address);
      }
      return map;
    })(),
  ]);
  const liveIdentity = (
    accountId: string | null | undefined,
    payerAddress: string | null | undefined,
    frozen: string | null | undefined,
  ): string | null => {
    const entry = accountId ? handleMap[accountId] : null;
    if (entry?.handle) return `@${entry.handle}`;
    return (accountId && primaryByAccount.get(accountId)) || frozen || payerAddress || null;
  };
  // The actor's chosen handle color — only when they currently show a @handle
  // (an address byline gets no tint, matching the feed).
  const liveColor = (accountId: string | null | undefined): string | null => {
    const entry = accountId ? handleMap[accountId] : null;
    return entry?.handle ? entry.color ?? null : null;
  };

  // ---- feed posts / replies / quotes (mint cards ride `handles` instead) ----
  for (const p of posts) {
    if (p.card_kind === "handle_mint") continue; // deduped: mints come from `handles`
    const kind = p.action === 2 ? "reply" : p.action === 3 ? "quote" : "post";
    const identity = liveIdentity(p.author_account_id, p.payer_address, p.author_identity);
    items.push({
      id: `fp:${p.txid}`,
      kind,
      actor: displayIdentity(identity, "someone"),
      color: liveColor(p.author_account_id),
      actorHref: profileHref(identity),
      actorAccountId: p.author_account_id,
      target: snippet(p.content),
      amountXec: p.amount_sats == null ? null : p.amount_sats / 100,
      at: p.created_at,
      href: `/feed/${p.txid}`,
      txid: p.txid,
    });
  }

  // ---- likes / tips / reposts ----
  for (const e of events) {
    const kind =
      e.action === 4 ? "repost" : (e.amount_sats ?? 0) > LIKE_FLOOR_SATS ? "tip" : "like";
    const info = e.target_txid ? targetInfo.get(e.target_txid) : null;
    const targetIdentity = info
      ? liveIdentity(info.authorAccountId, info.payerAddress, info.authorIdentity)
      : null;
    const targetText =
      (info ? snippet(info.content) : null) ??
      (targetIdentity ? displayIdentity(targetIdentity, "") || null : null);
    const actorIdentity = liveIdentity(e.actor_account_id, e.payer_address, e.actor_identity);
    items.push({
      id: `fe:${e.txid}`,
      kind,
      actor: displayIdentity(actorIdentity, "someone"),
      color: liveColor(e.actor_account_id),
      actorHref: profileHref(actorIdentity),
      actorAccountId: e.actor_account_id,
      // The reposted/liked post's author — so a repost of a blocked account's
      // post is hidden even though the reposter isn't blocked.
      targetAccountId: info?.authorAccountId ?? null,
      target: targetText,
      amountXec: e.amount_sats == null ? null : e.amount_sats / 100,
      at: e.created_at,
      href: e.target_txid ? `/feed/${e.target_txid}` : "/",
      txid: e.txid,
    });
  }

  // ---- article unlocks — reader byline resolved from their account ----
  type UnlockRow = {
    txid: string; payer_address: string | null; unlocked_at: string;
    posts: { title: string | null; slug: string | null; price_xec: number | null; legacy?: boolean | null } | null;
  };
  // Site-wide: recent unlocks. Scoped: unlocks OF their articles (revenue in) +
  // unlocks THEY paid for on others' articles (outbound), merged + de-duped.
  const unlocks = dedupeByTxid([
    ...((unlocksQ.data ?? []) as unknown as UnlockRow[]),
    ...((outUnlocksQ.data ?? []) as unknown as UnlockRow[]),
  ]);
  const payerBare = [
    ...new Set(unlocks.map((u) => (u.payer_address ? bare(u.payer_address) : null)).filter(Boolean)),
  ] as string[];
  // payer bare address -> the reader account's canonical byline: current @handle,
  // else the account's PRIMARY wallet address — NOT the payer, since a Pocket
  // unlock's payer is the linked, non-primary pocket address. Strays (no account)
  // are absent and fall back to the payer address in the loop below.
  const payerIdentity = new Map<string, string>();
  // payer bare address -> reader ACCOUNT id, so an unlock row can be dropped when
  // the viewer has blocked that reader (scoped profile rails show unlocks).
  const payerAccountId = new Map<string, string>();
  if (payerBare.length > 0) {
    const forms = payerBare.flatMap((b) => [b, `ecash:${b}`]);
    const { data: links } = await supabase
      .from("account_addresses")
      .select("address, account_id")
      .in("address", forms);
    const accountByAddr = new Map(
      ((links ?? []) as Array<{ address: string; account_id: string }>).map((l) => [
        bare(l.address),
        l.account_id,
      ])
    );
    for (const [addr, accountId] of accountByAddr) payerAccountId.set(addr, accountId);
    const accountIds = [...new Set(accountByAddr.values())];
    if (accountIds.length > 0) {
      const [{ data: accounts }, { data: primaries }] = await Promise.all([
        supabase.from("accounts").select("id, display_handle").in("id", accountIds),
        supabase
          .from("account_addresses")
          .select("account_id, address")
          .in("account_id", accountIds)
          .eq("is_primary", true),
      ]);
      const handleByAccount = new Map(
        ((accounts ?? []) as Array<{ id: string; display_handle: string | null }>).map((a) => [
          a.id,
          a.display_handle,
        ])
      );
      const primaryByAccount = new Map<string, string>();
      for (const r of (primaries ?? []) as Array<{ account_id: string; address: string }>) {
        if (!primaryByAccount.has(r.account_id)) primaryByAccount.set(r.account_id, r.address);
      }
      for (const [addr, accountId] of accountByAddr) {
        const dh = handleByAccount.get(accountId);
        const identity = dh ? `@${dh}` : primaryByAccount.get(accountId) ?? null;
        if (identity) payerIdentity.set(addr, identity);
      }
    }
  }
  for (const u of unlocks) {
    if (!u.posts?.slug) continue;
    const payer = u.payer_address ? bare(u.payer_address) : null;
    // Account byline when resolvable, else the raw payer (a stray, never-logged-in
    // wallet) — displayIdentity truncates addresses, keeps @handles as-is.
    const identity = payer ? payerIdentity.get(payer) ?? `ecash:${payer}` : null;
    items.push({
      id: `un:${u.txid}`,
      kind: "unlock",
      actor: identity ? displayIdentity(identity, "a reader") : "a reader",
      actorHref: profileHref(identity),
      actorAccountId: payer ? payerAccountId.get(payer) ?? null : null,
      target: u.posts.title ?? "an article",
      amountXec: u.posts.price_xec ?? null,
      at: u.unlocked_at,
      href: articleHref(u.posts.slug, u.posts.legacy),
      slug: u.posts.slug,
      txid: u.txid,
    });
  }

  // ---- article publishes — author byline via their account's handle ----
  type PublishRow = {
    txid: string; amount_sats: number | null; paid_at: string; author_id: string | null;
    posts: { title: string | null; slug: string | null; legacy?: boolean | null } | null;
  };
  const publishes = (publishesQ.data ?? []) as unknown as PublishRow[];
  const authorIds = [...new Set(publishes.map((p) => p.author_id).filter(Boolean))] as string[];
  const authorDisplay = new Map<string, string>();
  // authorDisplay truncates the address for display; authorRaw keeps the FULL
  // identity ("@handle" or full bare address) so the byline can link to a profile.
  const authorRaw = new Map<string, string>();
  // Chosen handle color, keyed by author_id — only set for authors showing a handle.
  const authorColor = new Map<string, string>();
  // author_id -> ACCOUNT id, so a publish row can be dropped when the viewer
  // blocked that author (blocks are keyed by account, publishes by author_id).
  const authorAccount = new Map<string, string>();
  if (authorIds.length > 0) {
    const [{ data: accounts }, { data: authors }] = await Promise.all([
      supabase.from("accounts").select("id, author_id, display_handle, handle_color").in("author_id", authorIds),
      supabase.from("authors").select("id, xec_address").in("id", authorIds),
    ]);
    for (const a of (authors ?? []) as Array<{ id: string; xec_address: string | null }>) {
      if (a.xec_address) {
        authorDisplay.set(a.id, shortAddr(a.xec_address));
        authorRaw.set(a.id, bare(a.xec_address));
      }
    }
    for (const a of (accounts ?? []) as Array<{ id: string; author_id: string; display_handle: string | null; handle_color: string | null }>) {
      if (a.author_id) authorAccount.set(a.author_id, a.id);
      if (a.display_handle) {
        authorDisplay.set(a.author_id, `@${a.display_handle}`);
        authorRaw.set(a.author_id, `@${a.display_handle}`);
        if (a.handle_color) authorColor.set(a.author_id, a.handle_color);
      }
    }
  }
  for (const p of publishes) {
    if (!p.posts?.slug) continue;
    items.push({
      id: `pb:${p.txid}`,
      kind: "publish",
      actor: (p.author_id ? authorDisplay.get(p.author_id) : null) ?? "an author",
      color: (p.author_id ? authorColor.get(p.author_id) : null) ?? null,
      actorHref: profileHref(p.author_id ? authorRaw.get(p.author_id) : null),
      actorAccountId: (p.author_id ? authorAccount.get(p.author_id) : null) ?? null,
      target: p.posts.title ?? "an article",
      amountXec: p.amount_sats == null ? null : p.amount_sats / 100,
      at: p.paid_at,
      href: articleHref(p.posts.slug, p.posts.legacy),
      slug: p.posts.slug,
      txid: p.txid,
    });
  }

  // ---- handle mints — the minted name is the story ----
  type MintRow = { token_id: string; handle: string; tier: string | null; created_at: string };
  for (const m of (mintsQ.data ?? []) as MintRow[]) {
    items.push({
      id: `mt:${m.token_id}`,
      kind: "mint",
      actor: `@${m.handle}`,
      actorHref: `/@${encodeURIComponent(m.handle)}`,
      // A mint row names the handle, not an account — no owner to block against.
      actorAccountId: null,
      target: null,
      amountXec: priceForHandle(m.handle).priceXec,
      at: m.created_at,
      href: `/@${m.handle}`,
      txid: m.token_id,
    });
  }

  // ---- scoped: the author's OWN handle mints. The mint feed card is authored by
  //      the official mint account, so it's matched via card_meta.minterAddress
  //      (set on both paid mints and free claims); render like the site-wide rows. ----
  type ScopedMintRow = {
    txid: string;
    card_meta: { handle?: string; tier?: string; priceXec?: number; minterAddress?: string } | null;
    created_at: string;
  };
  for (const m of (scopedMintsQ.data ?? []) as ScopedMintRow[]) {
    const handle = m.card_meta?.handle;
    if (!handle) continue;
    items.push({
      id: `mt:${m.txid}`,
      kind: "mint",
      actor: `@${handle}`,
      actorHref: `/@${encodeURIComponent(handle)}`,
      actorAccountId: null,
      target: null,
      amountXec: priceForHandle(handle).priceXec,
      at: m.created_at,
      href: `/@${handle}`,
      txid: m.txid,
    });
  }

  // ---- paid article comments / replies — link to the article's comments ----
  for (const c of comments) {
    const cp = Array.isArray(c.posts) ? c.posts[0] : c.posts;
    if (!cp?.slug) continue;
    const identity = liveIdentity(c.author_account_id, c.payer_address, c.author_identity);
    items.push({
      id: `cm:${c.txid}`,
      kind: "comment",
      actor: displayIdentity(identity, "someone"),
      color: liveColor(c.author_account_id),
      actorHref: profileHref(identity),
      actorAccountId: c.author_account_id,
      // The article, not the (paywalled) comment text — see the query note.
      target: cp.title ?? "an article",
      amountXec: c.amount_sats == null ? null : c.amount_sats / 100,
      at: c.created_at,
      href: `${articleHref(cp.slug, cp.legacy)}#comments`,
      slug: cp.slug,
      txid: c.txid,
    });
  }

  // ---- paid LIKES on article comments — reference the article, link to #comments ----
  for (const e of commentLikes) {
    const art = clArticleByComment.get(e.target_txid);
    if (!art?.slug) continue;
    const identity = liveIdentity(e.actor_account_id, e.payer_address, e.actor_identity);
    items.push({
      id: `cl:${e.txid}`,
      kind: "comment_like",
      actor: displayIdentity(identity, "someone"),
      color: liveColor(e.actor_account_id),
      actorHref: profileHref(identity),
      actorAccountId: e.actor_account_id,
      // The article, never the paywalled comment body.
      target: art.title ?? "an article",
      amountXec: e.amount_sats == null ? null : e.amount_sats / 100,
      at: e.created_at,
      href: `${articleHref(art.slug, art.legacy)}#comments`,
      slug: art.slug,
      txid: e.txid,
    });
  }

  items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  // Reactions are off BOTH rails: likes (post and comment) and tips are the
  // highest-volume rows on the site and they crowded out the writing itself.
  // UNLOCKS are the one difference — hidden on the global rail, kept on a
  // profile's "economy" rail, where they're that author's sales ledger.
  //
  // The sources above already avoid fetching what's hidden; this is the backstop
  // that keeps the contract in one readable place.
  const HIDDEN_EVERYWHERE = new Set(["like", "comment_like", "tip"]);
  const visible = items.filter(
    (i) => !HIDDEN_EVERYWHERE.has(i.kind) && (scoped || i.kind !== "unlock"),
  );
  const page = visible.slice(0, MAX_ITEMS);

  return NextResponse.json(
    { ok: true, items: page },
    // Just enough CDN cache to absorb a crowd's polling without making a
    // fresh action wait a poll cycle to appear (the old 30s SWR did). The
    // stream is viewer-NEUTRAL and stays cacheable: blocked-account filtering
    // is layered on per-viewer in the client (ActivityRail), exactly like the
    // For You feed's viewer-state overlay — each item carries actorAccountId so
    // the client can drop blocked authors after the shared payload paints.
    { headers: { "Cache-Control": "public, s-maxage=2, stale-while-revalidate=8" } }
  );
}
