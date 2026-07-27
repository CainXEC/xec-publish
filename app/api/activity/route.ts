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
import { createClient } from "@supabase/supabase-js";
import { priceForHandle } from "@/lib/handlePricing";
import { displayHandlesByAccountId } from "@/lib/authorDisplayHandles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabase = createClient(
  (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL)!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

// A plain like is the 100 XEC floor; anything above it is a tip.
const LIKE_FLOOR_SATS = 10_000;

const PER_SOURCE = 30;
const MAX_ITEMS = 48;

export type ActivityItem = {
  id: string;
  kind:
    | "post" | "reply" | "quote"
    | "like" | "tip" | "repost"
    | "unlock" | "publish" | "mint" | "comment";
  /** Frozen display byline: "@handle" or a raw eCash address. */
  actor: string;
  /** Link to the actor's profile ("/@handle" or "/a/<address>"), or null for
   *  placeholder bylines ("a reader", "an author") that have no profile. */
  actorHref: string | null;
  /** Who/what the action touched: a post author byline, article title, or handle. */
  target: string | null;
  amountXec: number | null;
  at: string;
  href: string;
  txid: string | null;
};

const snippet = (s: unknown, n = 56) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

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

export async function GET(req: NextRequest) {
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

  let eventsQuery = supabase
    .from("feed_events")
    .select("txid, action, actor_account_id, actor_identity, payer_address, amount_sats, target_txid, created_at")
    .order("created_at", { ascending: false })
    .limit(PER_SOURCE);
  if (scoped) {
    // payout_address = who the reaction PAID, i.e. the author of the target
    // post — exactly "value this author received".
    eventsQuery = addressForms.length > 0
      ? eventsQuery.in("payout_address", addressForms)
      : eventsQuery.eq("txid", "-"); // unmatchable → empty source
  }

  let unlocksQuery = supabase
    .from("unlocks")
    .select("txid, payer_address, unlocked_at, posts!inner(title, slug, price_xec, author_id, legacy)")
    .order("unlocked_at", { ascending: false })
    .limit(PER_SOURCE);
  if (scoped) {
    unlocksQuery = authorId
      ? unlocksQuery.eq("posts.author_id", authorId)
      : unlocksQuery.eq("txid", "-");
  }

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

  const [postsQ, eventsQ, unlocksQ, publishesQ, mintsQ, commentsQ, ownRepostsQ] = await Promise.all([
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
          .from("comments")
          .select("txid, author_account_id, author_identity, payer_address, amount_sats, content, created_at, posts!inner(title, slug, legacy)")
          .is("deleted_at", null)
          .not("txid", "is", null)
          .order("created_at", { ascending: false })
          .limit(PER_SOURCE),
    // Scoped only: the author's OWN reposts. The main events query returns
    // reactions the author RECEIVED (payout_address = them); a repost is a
    // content action like a reply/quote — which already appear as their
    // feed_posts — so without this an author who reposts but isn't reposted
    // shows none. Likes/tips they MADE stay out (value spent, shown on the
    // payee's economy, not content). Merged + de-duped into `events` below.
    scoped && scopedAccountId
      ? supabase
          .from("feed_events")
          .select("txid, action, actor_account_id, actor_identity, payer_address, amount_sats, target_txid, created_at")
          .eq("actor_account_id", scopedAccountId)
          .eq("action", 4)
          .order("created_at", { ascending: false })
          .limit(PER_SOURCE)
      : Promise.resolve({ data: [] as Array<never> }),
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
    content: string | null; created_at: string;
    posts: { title: string | null; slug: string | null; legacy?: boolean | null } | null;
  };
  const posts = (postsQ.data ?? []) as PostRow[];
  const comments = (commentsQ.data ?? []) as unknown as CommentRow[];
  // Reactions the author received + (scoped) their own reposts, de-duped by txid
  // — the final items.sort() below orders the merged stream by time.
  const seenEventTxids = new Set<string>();
  const events = [
    ...((eventsQ.data ?? []) as EventRow[]),
    ...((ownRepostsQ.data ?? []) as EventRow[]),
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
  ].filter(Boolean) as string[];
  const handleMap = await displayHandlesByAccountId(bylineAccountIds, supabase);
  // @handle when the account currently holds one, else the raw payer address,
  // else the frozen snapshot — identical precedence to getFeed's identityFor.
  const liveIdentity = (
    accountId: string | null | undefined,
    payerAddress: string | null | undefined,
    frozen: string | null | undefined,
  ): string | null => {
    const entry = accountId ? handleMap[accountId] : null;
    if (entry?.handle) return `@${entry.handle}`;
    return payerAddress || frozen || null;
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
      actorHref: profileHref(identity),
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
      actorHref: profileHref(actorIdentity),
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
  const unlocks = (unlocksQ.data ?? []) as unknown as UnlockRow[];
  const payerBare = [
    ...new Set(unlocks.map((u) => (u.payer_address ? bare(u.payer_address) : null)).filter(Boolean)),
  ] as string[];
  const payerDisplay = new Map<string, string>();
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
    const accountIds = [...new Set(accountByAddr.values())];
    if (accountIds.length > 0) {
      const { data: accounts } = await supabase
        .from("accounts")
        .select("id, display_handle")
        .in("id", accountIds);
      const handleByAccount = new Map(
        ((accounts ?? []) as Array<{ id: string; display_handle: string | null }>).map((a) => [
          a.id,
          a.display_handle,
        ])
      );
      for (const [addr, accountId] of accountByAddr) {
        const dh = handleByAccount.get(accountId);
        if (dh) payerDisplay.set(addr, `@${dh}`);
      }
    }
  }
  for (const u of unlocks) {
    if (!u.posts?.slug) continue;
    const payer = u.payer_address ? bare(u.payer_address) : null;
    items.push({
      id: `un:${u.txid}`,
      kind: "unlock",
      actor: payer ? payerDisplay.get(payer) ?? shortAddr(payer) : "a reader",
      actorHref: profileHref(payer ? payerDisplay.get(payer) ?? payer : null),
      target: u.posts.title ?? "an article",
      amountXec: u.posts.price_xec ?? null,
      at: u.unlocked_at,
      href: articleHref(u.posts.slug, u.posts.legacy),
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
  if (authorIds.length > 0) {
    const [{ data: accounts }, { data: authors }] = await Promise.all([
      supabase.from("accounts").select("author_id, display_handle").in("author_id", authorIds),
      supabase.from("authors").select("id, xec_address").in("id", authorIds),
    ]);
    for (const a of (authors ?? []) as Array<{ id: string; xec_address: string | null }>) {
      if (a.xec_address) {
        authorDisplay.set(a.id, shortAddr(a.xec_address));
        authorRaw.set(a.id, bare(a.xec_address));
      }
    }
    for (const a of (accounts ?? []) as Array<{ author_id: string; display_handle: string | null }>) {
      if (a.display_handle) {
        authorDisplay.set(a.author_id, `@${a.display_handle}`);
        authorRaw.set(a.author_id, `@${a.display_handle}`);
      }
    }
  }
  for (const p of publishes) {
    if (!p.posts?.slug) continue;
    items.push({
      id: `pb:${p.txid}`,
      kind: "publish",
      actor: (p.author_id ? authorDisplay.get(p.author_id) : null) ?? "an author",
      actorHref: profileHref(p.author_id ? authorRaw.get(p.author_id) : null),
      target: p.posts.title ?? "an article",
      amountXec: p.amount_sats == null ? null : p.amount_sats / 100,
      at: p.paid_at,
      href: articleHref(p.posts.slug, p.posts.legacy),
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
      target: null,
      amountXec: priceForHandle(m.handle).priceXec,
      at: m.created_at,
      href: `/@${m.handle}`,
      txid: m.token_id,
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
      actorHref: profileHref(identity),
      target: snippet(c.content),
      amountXec: c.amount_sats == null ? null : c.amount_sats / 100,
      at: c.created_at,
      href: `${articleHref(cp.slug, cp.legacy)}#comments`,
      txid: c.txid,
    });
  }

  items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const page = items.slice(0, MAX_ITEMS);

  return NextResponse.json(
    { ok: true, items: page },
    // Just enough CDN cache to absorb a crowd's polling without making a
    // fresh action wait a poll cycle to appear (the old 30s SWR did).
    { headers: { "Cache-Control": "public, s-maxage=2, stale-while-revalidate=8" } }
  );
}
