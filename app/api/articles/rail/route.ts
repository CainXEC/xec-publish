// =============================================================================
//  app/api/articles/rail/route.ts — the desktop left rail's "front page".
//
//  One payload for the newspaper rail: a LEAD story, a MORE STORIES list, and
//  MOST READ THIS WEEK — plus dateline stats. Ranking is deliberately LEGIBLE
//  (the anti-black-box to the feed's engagement ranker):
//    lead     = (1 + all-time readers) · exp(−age_days / 3) · sublinear price nudge
//    more     = pure chronology (newest first)
//    mostRead = ranked by RECENT (7-day) unlock volume — this is how an OLD or
//               legacy article being unlocked a lot right now resurfaces on the
//               front page, independent of its age.
//  Reader counts come from the get_unlock_counts RPC, so "readers" here always
//  means verified on-chain unlocks, never views. That RPC — and its sibling
//  get_recent_hot_posts, which pulls hot legacy posts into the candidate pool so
//  they can appear here at all — excludes house/AI unlockers (authors.is_ai): a
//  patron's grants pay the author for real but must not inflate this public reach
//  ranking (see sql/rpc_get_unlock_counts.sql, sql/rpc_get_recent_hot_posts.sql).
//
//  posts.published_at is null on paid-flow posts — created_at is the real
//  publication moment there, so both are selected and coalesced.
// =============================================================================

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { fetchAllUnlockCountRows } from "@/lib/supabaseUnlockCounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabase = createClient(
  (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL)!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const CANDIDATES = 40;
// The front-page rail scrolls independently (.feed-left is a sticky, overflowing
// column), so "More stories" can run long without shifting the page — 12 gives a
// fuller front page while staying curated.
const MORE_N = 12;
// "Most Read this week": how many recently-hot articles the section lists, and how
// many hot posts to pull into the candidate pool so an OLD/legacy article being
// unlocked a lot right now can resurface — the recency-only pools below would never
// include it. See sql/rpc_get_recent_hot_posts.sql.
const MOST_READ_N = 6;
const HOT_CANDIDATES = 24;

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
  readers: number;
  readers7d: number;
  comments: number;
};

const bare = (address: string) => address.replace(/^ecash:/, "").toLowerCase();
const shortAddr = (address: string) => {
  const b = bare(address);
  return `${b.slice(0, 8)}…${b.slice(-4)}`;
};

export async function GET() {
  type PostRow = {
    id: string; title: string | null; slug: string | null; teaser: string | null;
    price_xec: number | null; reading_time_minutes: number | null;
    published_at: string | null; created_at: string | null; author_id: string | null;
    legacy: boolean | null;
  };

  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const COLS =
    "id, title, slug, teaser, price_xec, reading_time_minutes, published_at, created_at, author_id, legacy";

  // The candidate pool must be picked by PUBLICATION recency, not draft
  // creation — a long-drafted post goes live today with an old created_at, so a
  // pool ordered only by created_at silently excludes it (loadAuthorProfile
  // documents the same trap). We can't COALESCE inside .order(), so take the
  // union of two pools — newest-created AND newest-published — and dedupe.
  // The created_at pool also covers legacy paid-flow posts whose published_at
  // is null (created_at is their real go-live moment); the published_at pool
  // (nulls last) catches the long-drafted just-published case. The JS ranking
  // below then sorts the merged set by published_at ?? created_at.
  const [byCreated, byPublished, hotRes] = await Promise.all([
    supabase
      .from("posts").select(COLS).eq("published", true)
      .order("created_at", { ascending: false }).limit(CANDIDATES),
    supabase
      .from("posts").select(COLS).eq("published", true)
      .order("published_at", { ascending: false, nullsFirst: false }).limit(CANDIDATES),
    // Recently-hot posts by 7-day unlock volume (house/AI excluded). This is the
    // ONLY way an old/legacy article enters the pool — the two pools above are
    // pure publication recency. Best-effort: if the RPC isn't applied yet we log
    // and carry on with just the recency pools, so the rail never breaks on it.
    supabase.rpc("get_recent_hot_posts", { since: since7d, max_posts: HOT_CANDIDATES }),
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

  // ---- readers: all-time (display) + 7-day (ranking) + comment counts ----
  const readers = new Map<string, number>();
  const readers7d = new Map<string, number>();
  const comments = new Map<string, number>();
  if (ids.length > 0) {
    const [allTime, week, commentRes] = await Promise.all([
      fetchAllUnlockCountRows(supabase, ids, null),
      fetchAllUnlockCountRows(supabase, ids, since7d),
      supabase.rpc("get_comment_counts", { post_ids: ids }),
    ]);
    for (const r of allTime.rows ?? []) readers.set(r.post_id, Number(r.count) || 0);
    for (const r of week.rows ?? []) readers7d.set(r.post_id, Number(r.count) || 0);
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
    readers: readers.get(p.id) ?? 0,
    readers7d: readers7d.get(p.id) ?? 0,
    comments: comments.get(p.id) ?? 0,
  }));

  // ---- the legible ranking: a LEAD story, then MORE STORIES in chronology.
  //  Lead score = breadth × freshness × a SUBLINEAR price nudge:
  //      (1 + readers) · exp(−ageDays / HALF_LIFE) · (1 + log10(1 + priceXec))
  //  Breadth (reader count) dominates; freshness decays it over days so a stale
  //  hit yields the front page; the log price factor lets a pricier article edge
  //  ahead of an equally-read cheaper one WITHOUT letting one costly unlock top a
  //  widely-read piece (price is author-set, so it may only nudge, never rule).
  //  The (1 + readers) base means a brand-new, unread post can still lead on
  //  freshness alone, so the page is never empty right after a publish. ----
  const HALF_LIFE_DAYS = 3;
  const now = Date.now();
  const priceFactor = (price: number | null) =>
    1 + Math.log10(1 + Math.max(0, Number(price) || 0));
  const freshness = (iso: string) => {
    const ageDays = Math.max(0, (now - Date.parse(iso)) / 86_400_000);
    return Math.exp(-ageDays / HALF_LIFE_DAYS);
  };
  const score = (s: RailStory) =>
    (1 + s.readers) * freshness(s.at) * priceFactor(s.priceXec);

  const lead = stories.length > 0
    ? [...stories].sort((a, b) => score(b) - score(a))[0]
    : null;

  // "Most Read this week": ranked purely by recent (7-day) unlock volume, so an
  // OLD or legacy piece being unlocked a lot right now resurfaces here regardless
  // of age. readers7d comes from get_unlock_counts, so house/AI unlocks are
  // already excluded. Drop the lead (no hero dupe) and anything with zero recent
  // unlocks (nothing to be "most read" about). Ties break toward the newer piece.
  const mostRead = stories
    .filter((s) => s.id !== lead?.id && s.readers7d > 0)
    .sort((a, b) => b.readers7d - a.readers7d || (a.at < b.at ? 1 : -1))
    .slice(0, MOST_READ_N);

  // "More stories": newest-first, but skip the lead AND anything already shown in
  // "Most read this week" directly above — a repeat there reads as a bug.
  const shownIds = new Set(
    [lead?.id, ...mostRead.map((s) => s.id)].filter(Boolean),
  );
  const more = stories
    .filter((s) => !shownIds.has(s.id))
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, MORE_N);

  return NextResponse.json(
    { ok: true, lead, more, mostRead },
    // Publishes are rare events; a minute of CDN cache keeps this free.
    { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } }
  );
}
