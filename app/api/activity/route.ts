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
//
//  `final` mirrors Avalanche finality where the source tracks it
//  (feed_posts/feed_events.finalized_at — stamped by the reconcile sweep);
//  unlocks, publishes and mints are recorded at-or-after finality by
//  construction, so they're always final here.
// =============================================================================

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { priceForHandle } from "@/lib/handlePricing";

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
    | "unlock" | "publish" | "mint";
  /** Frozen display byline: "@handle" or a raw eCash address. */
  actor: string;
  /** Who/what the action touched: a post author byline, article title, or handle. */
  target: string | null;
  amountXec: number | null;
  at: string;
  final: boolean;
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

// Identity snapshots are "@handle" or a raw eCash address; addresses get the
// same truncation the rest of the UI uses so the rail stays scannable.
const displayIdentity = (identity: string | null | undefined, fallback: string) => {
  const id = String(identity ?? "").trim();
  if (!id) return fallback;
  return id.startsWith("@") ? id : shortAddr(id);
};

export async function GET() {
  const [postsQ, eventsQ, unlocksQ, publishesQ, mintsQ] = await Promise.all([
    supabase
      .from("feed_posts")
      .select("txid, action, author_identity, amount_sats, content, created_at, finalized_at, card_kind")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(PER_SOURCE),
    supabase
      .from("feed_events")
      .select("txid, action, actor_identity, amount_sats, target_txid, created_at, finalized_at")
      .order("created_at", { ascending: false })
      .limit(PER_SOURCE),
    supabase
      .from("unlocks")
      .select("txid, payer_address, unlocked_at, posts(title, slug, price_xec)")
      .order("unlocked_at", { ascending: false })
      .limit(PER_SOURCE),
    supabase
      .from("publishes")
      .select("txid, amount_sats, paid_at, author_id, posts(title, slug)")
      .order("paid_at", { ascending: false })
      .limit(PER_SOURCE),
    supabase
      .from("handles")
      .select("token_id, handle, tier, created_at")
      .order("created_at", { ascending: false })
      .limit(PER_SOURCE),
  ]);

  const items: ActivityItem[] = [];

  // ---- feed posts / replies / quotes (mint cards ride `handles` instead) ----
  type PostRow = {
    txid: string; action: number; author_identity: string | null;
    amount_sats: number | null; content: string | null; created_at: string;
    finalized_at: string | null; card_kind: string | null;
  };
  const posts = (postsQ.data ?? []) as PostRow[];
  for (const p of posts) {
    if (p.card_kind === "handle_mint") continue; // deduped: mints come from `handles`
    const kind = p.action === 2 ? "reply" : p.action === 3 ? "quote" : "post";
    items.push({
      id: `fp:${p.txid}`,
      kind,
      actor: displayIdentity(p.author_identity, "someone"),
      target: snippet(p.content),
      amountXec: p.amount_sats == null ? null : p.amount_sats / 100,
      at: p.created_at,
      final: p.finalized_at != null,
      href: `/feed/${p.txid}`,
      txid: p.txid,
    });
  }

  // ---- likes / tips / reposts — resolve who the target post belongs to ----
  type EventRow = {
    txid: string; action: number; actor_identity: string | null;
    amount_sats: number | null; target_txid: string | null; created_at: string;
    finalized_at: string | null;
  };
  const events = (eventsQ.data ?? []) as EventRow[];
  const targetTxids = [...new Set(events.map((e) => e.target_txid).filter(Boolean))] as string[];
  const targetAuthor = new Map<string, string>();
  if (targetTxids.length > 0) {
    const { data: targets } = await supabase
      .from("feed_posts")
      .select("txid, author_identity")
      .in("txid", targetTxids);
    for (const t of (targets ?? []) as Array<{ txid: string; author_identity: string | null }>) {
      if (t.author_identity) targetAuthor.set(t.txid, t.author_identity);
    }
  }
  for (const e of events) {
    const kind =
      e.action === 4 ? "repost" : (e.amount_sats ?? 0) > LIKE_FLOOR_SATS ? "tip" : "like";
    items.push({
      id: `fe:${e.txid}`,
      kind,
      actor: displayIdentity(e.actor_identity, "someone"),
      target: e.target_txid
        ? displayIdentity(targetAuthor.get(e.target_txid), "") || null
        : null,
      amountXec: e.amount_sats == null ? null : e.amount_sats / 100,
      at: e.created_at,
      final: e.finalized_at != null,
      href: e.target_txid ? `/feed/${e.target_txid}` : "/",
      txid: e.txid,
    });
  }

  // ---- article unlocks — reader byline resolved from their account ----
  type UnlockRow = {
    txid: string; payer_address: string | null; unlocked_at: string;
    posts: { title: string | null; slug: string | null; price_xec: number | null } | null;
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
      target: u.posts.title ?? "an article",
      amountXec: u.posts.price_xec ?? null,
      at: u.unlocked_at,
      final: true, // recorded only after Avalanche finality
      href: `/posts/${u.posts.slug}`,
      txid: u.txid,
    });
  }

  // ---- article publishes — author byline via their account's handle ----
  type PublishRow = {
    txid: string; amount_sats: number | null; paid_at: string; author_id: string | null;
    posts: { title: string | null; slug: string | null } | null;
  };
  const publishes = (publishesQ.data ?? []) as unknown as PublishRow[];
  const authorIds = [...new Set(publishes.map((p) => p.author_id).filter(Boolean))] as string[];
  const authorDisplay = new Map<string, string>();
  if (authorIds.length > 0) {
    const [{ data: accounts }, { data: authors }] = await Promise.all([
      supabase.from("accounts").select("author_id, display_handle").in("author_id", authorIds),
      supabase.from("authors").select("id, xec_address").in("id", authorIds),
    ]);
    for (const a of (authors ?? []) as Array<{ id: string; xec_address: string | null }>) {
      if (a.xec_address) authorDisplay.set(a.id, shortAddr(a.xec_address));
    }
    for (const a of (accounts ?? []) as Array<{ author_id: string; display_handle: string | null }>) {
      if (a.display_handle) authorDisplay.set(a.author_id, `@${a.display_handle}`);
    }
  }
  for (const p of publishes) {
    if (!p.posts?.slug) continue;
    items.push({
      id: `pb:${p.txid}`,
      kind: "publish",
      actor: (p.author_id ? authorDisplay.get(p.author_id) : null) ?? "an author",
      target: p.posts.title ?? "an article",
      amountXec: p.amount_sats == null ? null : p.amount_sats / 100,
      at: p.paid_at,
      final: true, // fee verified on-chain before the row is written
      href: `/posts/${p.posts.slug}`,
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
      target: null,
      amountXec: priceForHandle(m.handle).priceXec,
      at: m.created_at,
      final: true, // the NFT exists on-chain
      href: `/@${m.handle}`,
      txid: m.token_id,
    });
  }

  items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  return NextResponse.json(
    { ok: true, items: items.slice(0, MAX_ITEMS) },
    // Let the CDN absorb rail polling across visitors; 5s is still "live".
    { headers: { "Cache-Control": "public, s-maxage=5, stale-while-revalidate=30" } }
  );
}
