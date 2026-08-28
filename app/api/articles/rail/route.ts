// =============================================================================
//  app/api/articles/rail/route.ts — the front page's "front page" rail.
//
//  ONE filtered list of up to 25 stories. `?range=` picks the lens (default 7d):
//    24h / 7d / all  → MOST READ: ranked by verified on-chain unlock volume over
//                      that window (24h/7d/all-time). This is how an OLD or legacy
//                      article being unlocked a lot right now resurfaces here,
//                      independent of age. #1 is the hero.
//    latest          → newest published first (published_at ?? created_at), no
//                      read filter — a plain chronology.
//  Reader counts come from the get_unlock_counts / get_recent_hot_posts RPCs, so
//  "reads" always means verified unlocks, never views — and both exclude house/AI
//  unlockers (authors.is_ai) so a patron's grants can't inflate this public reach
//  ranking (sql/rpc_get_unlock_counts.sql, sql/rpc_get_recent_hot_posts.sql). Both
//  RPCs take a nullable `since` (NULL = all-time), so one value drives every window.
//
//  posts.published_at is null on paid-flow posts — created_at is the real
//  publication moment there, so both are selected and coalesced.
// =============================================================================

import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { adminDb } from "@/lib/db";
import { fetchAllUnlockCountRows } from "@/lib/supabaseUnlockCounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Deleting or publishing an article calls revalidateTag(ARTICLES_RAIL_CACHE_TAG)
// so the rail drops/picks it up immediately instead of waiting out the window
// below — see app/dashboard/deletePost.js. Before this tag existed the rail was
// only ever cached via a raw Cache-Control header, which a hard delete has no
// way to reach: revalidateTag/revalidatePath purge Next's OWN Data Cache, not a
// CDN entry created from a manually-set header on a force-dynamic route. Moving
// the caching into unstable_cache (same mechanism getFeed.js's FEED_CACHE_TAG
// uses) is what makes on-demand invalidation possible at all.
export const ARTICLES_RAIL_CACHE_TAG = "articles-rail";

const supabase = adminDb();

const CANDIDATES = 60;
// How many rows the rail lists.
const LIST_N = 25;
// How many hot post ids to pull into the candidate pool so an OLD/legacy article
// unlocked a lot in the window can resurface — the recency pools alone never would.
const HOT_CANDIDATES = 30;

type RangeKey = "24h" | "7d" | "all" | "latest";
function parseRange(v: string | null): RangeKey {
  return v === "24h" || v === "all" || v === "latest" ? v : "7d";
}
// The unlock-count window for a range: 24h / 7d back, or null (all-time) for
// 'all' and 'latest'.
function sinceFor(range: RangeKey): string | null {
  if (range === "24h") return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  if (range === "7d") return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  return null;
}

type RailStory = {
  id: string;
  title: string;
  slug: string;
  // Imported legacy posts keep their root permalink /{slug} (app/[slug]/page.js);
  // current posts live at /posts/{slug}. The client routes on this flag so a
  // resurfaced legacy article links to the page that can actually serve it.
  legacy: boolean;
  teaser: string | null;
  priceXec: number | null;
  readMinutes: number | null;
  at: string;
  author: string;
  // Unlock count over the selected window (all-time for 'all'/'latest'). The
  // ranking basis for the most-read ranges; shown as "N reads".
  count: number;
  comments: number;
};

const bare = (address: string) => address.replace(/^ecash:/, "").toLowerCase();
const shortAddr = (address: string) => {
  const b = bare(address);
  return `${b.slice(0, 8)}…${b.slice(-4)}`;
};

async function buildRailList(range: RangeKey): Promise<RailStory[]> {
  const isLatest = range === "latest";
  const since = sinceFor(range);

  type PostRow = {
    id: string; title: string | null; slug: string | null; teaser: string | null;
    price_xec: number | null; reading_time_minutes: number | null;
    published_at: string | null; created_at: string | null; author_id: string | null;
    legacy: boolean | null;
  };

  const COLS =
    "id, title, slug, teaser, price_xec, reading_time_minutes, published_at, created_at, author_id, legacy";

  // The candidate pool must be picked by PUBLICATION recency, not draft
  // creation — a long-drafted post goes live today with an old created_at, so a
  // pool ordered only by created_at silently excludes it (loadAuthorProfile
  // documents the same trap). We can't COALESCE inside .order(), so take the
  // union of two pools — newest-created AND newest-published — and dedupe.
  // For the MOST-READ ranges we also fold in get_recent_hot_posts (the hottest
  // over the window) — the ONLY way an old/legacy article resurfaces. 'latest'
  // is pure chronology, so it skips the hot pool.
  const [byCreated, byPublished, hotRes] = await Promise.all([
    supabase
      .from("posts").select(COLS).eq("published", true)
      .order("created_at", { ascending: false }).limit(CANDIDATES),
    supabase
      .from("posts").select(COLS).eq("published", true)
      .order("published_at", { ascending: false, nullsFirst: false }).limit(CANDIDATES),
    // Best-effort: if the RPC isn't applied yet we log and carry on with just the
    // recency pools, so the rail never breaks on it.
    isLatest
      ? Promise.resolve({ data: [], error: null } as { data: unknown; error: { message: string } | null })
      : supabase.rpc("get_recent_hot_posts", { since, max_posts: HOT_CANDIDATES }),
  ]);

  // Pull the full post rows for the hot ids the recency pools didn't already cover.
  const hotIds = Array.isArray(hotRes.data)
    ? (hotRes.data as Array<{ post_id: string }>).map((r) => r.post_id).filter(Boolean)
    : [];
  if (hotRes.error) {
    console.warn(
      "[articles/rail] get_recent_hot_posts unavailable — legacy resurfacing off until sql/rpc_get_recent_hot_posts.sql is applied:",
      hotRes.error.message,
    );
  }
  let hotPosts: PostRow[] = [];
  if (hotIds.length > 0) {
    const { data: hotRows } = await supabase
      .from("posts").select(COLS).eq("published", true).in("id", hotIds);
    hotPosts = (hotRows ?? []) as PostRow[];
  }

  const byId = new Map<string, PostRow>();
  for (const p of [
    ...(byCreated.data ?? []),
    ...(byPublished.data ?? []),
    ...hotPosts,
  ] as PostRow[]) {
    if (!byId.has(p.id)) byId.set(p.id, p);
  }
  const posts = [...byId.values()].filter((p) => p.slug && p.title);
  const ids = posts.map((p) => p.id);

  // ---- unlock count over the window (all-time for 'all'/'latest') + comments ----
  const count = new Map<string, number>();
  const comments = new Map<string, number>();
  if (ids.length > 0) {
    const [windowRows, commentRes] = await Promise.all([
      fetchAllUnlockCountRows(supabase, ids, since),
      supabase.rpc("get_comment_counts", { post_ids: ids }),
    ]);
    for (const r of windowRows.rows ?? []) count.set(r.post_id, Number(r.count) || 0);
    for (const r of (commentRes.data ?? []) as Array<{ post_id: string; count: number }>) {
      comments.set(r.post_id, Number(r.count) || 0);
    }
  }

  // ---- author bylines: account display handle, else the author's address ----
  const authorIds = [...new Set(posts.map((p) => p.author_id).filter(Boolean))] as string[];
  const byline = new Map<string, string>();
  if (authorIds.length > 0) {
    const [{ data: accounts }, { data: authors }] = await Promise.all([
      supabase.from("accounts").select("author_id, display_handle").in("author_id", authorIds),
      supabase.from("authors").select("id, xec_address").in("id", authorIds),
    ]);
    for (const a of (authors ?? []) as Array<{ id: string; xec_address: string | null }>) {
      if (a.xec_address) byline.set(a.id, shortAddr(a.xec_address));
    }
    for (const a of (accounts ?? []) as Array<{ author_id: string; display_handle: string | null }>) {
      if (a.display_handle) byline.set(a.author_id, `@${a.display_handle}`);
    }
  }

  const stories: RailStory[] = posts.map((p) => ({
    id: p.id,
    title: p.title as string,
    slug: p.slug as string,
    legacy: p.legacy === true,
    teaser: p.teaser,
    priceXec: p.price_xec,
    readMinutes: p.reading_time_minutes,
    at: p.published_at ?? p.created_at ?? new Date(0).toISOString(),
    author: (p.author_id ? byline.get(p.author_id) : null) ?? "an author",
    count: count.get(p.id) ?? 0,
    comments: comments.get(p.id) ?? 0,
  }));

  // The single list. MOST-READ ranges rank by unlock volume over the window and
  // drop anything with zero reads (nothing to be "most read" about); ties break
  // toward the newer piece. LATEST is pure chronology, newest first, no read
  // filter. Either way, the top 25.
  return isLatest
    ? [...stories].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, LIST_N)
    : stories
        .filter((s) => s.count > 0)
        .sort((a, b) => b.count - a.count || (a.at < b.at ? 1 : -1))
        .slice(0, LIST_N);
}

export async function GET(request: Request) {
  const range = parseRange(new URL(request.url).searchParams.get("range"));
  // Publishes and deletes are rare, so a minute of shared caching keeps this
  // free — but unlike a raw Cache-Control header, this is invalidatable
  // on-demand (see ARTICLES_RAIL_CACHE_TAG above).
  const list = await unstable_cache(
    () => buildRailList(range),
    ["articles-rail", range],
    { tags: [ARTICLES_RAIL_CACHE_TAG], revalidate: 60 },
  )();
  return NextResponse.json({ ok: true, range, stories: list });
}
