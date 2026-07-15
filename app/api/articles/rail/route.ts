// =============================================================================
//  app/api/articles/rail/route.ts — the desktop left rail's "front page".
//
//  One payload for the newspaper rail: a LEAD story, the LATEST list, and
//  MOST READ (7 days) — plus dateline stats. Ranking is deliberately LEGIBLE
//  (the anti-black-box to the feed's engagement ranker):
//    lead     = readers × freshness — (1 + unlocks_7d) · exp(−age_days / 3)
//    latest   = pure chronology
//    mostRead = a plain 7-day unlock counter
//  Reader counts come from the same get_unlock_counts RPC the feed ranking
//  uses (self/alt-ring filtering included), so "readers" here always means
//  verified on-chain unlocks, never views.
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
const MORE_N = 6;

type RailStory = {
  id: string;
  title: string;
  slug: string;
  teaser: string | null;
  priceXec: number | null;
  readMinutes: number | null;
  at: string;
  author: string;
  readers: number;
  readers7d: number;
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
  };

  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const postsQ = await supabase
    .from("posts")
    .select("id, title, slug, teaser, price_xec, reading_time_minutes, published_at, created_at, author_id")
    .eq("published", true)
    .order("created_at", { ascending: false })
    .limit(CANDIDATES);

  const posts = ((postsQ.data ?? []) as PostRow[]).filter((p) => p.slug && p.title);
  const ids = posts.map((p) => p.id);

  // ---- readers: all-time (display) + 7-day (ranking), via the shared RPC ----
  const readers = new Map<string, number>();
  const readers7d = new Map<string, number>();
  if (ids.length > 0) {
    const [allTime, week] = await Promise.all([
      fetchAllUnlockCountRows(supabase, ids, null),
      fetchAllUnlockCountRows(supabase, ids, since7d),
    ]);
    for (const r of allTime.rows ?? []) readers.set(r.post_id, Number(r.count) || 0);
    for (const r of week.rows ?? []) readers7d.set(r.post_id, Number(r.count) || 0);
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
    teaser: p.teaser,
    priceXec: p.price_xec,
    readMinutes: p.reading_time_minutes,
    at: p.published_at ?? p.created_at ?? new Date(0).toISOString(),
    author: (p.author_id ? byline.get(p.author_id) : null) ?? "an author",
    readers: readers.get(p.id) ?? 0,
    readers7d: readers7d.get(p.id) ?? 0,
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

  const more = stories
    .filter((s) => s.id !== lead?.id)
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, MORE_N);

  return NextResponse.json(
    { ok: true, lead, more },
    // Publishes are rare events; a minute of CDN cache keeps this free.
    { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } }
  );
}
