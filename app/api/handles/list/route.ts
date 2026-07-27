// =============================================================================
//  app/api/handles/list/route.ts
//  Public, read-only listing of minted handles for the marketplace gallery.
//  Paginated (offset), searchable (?q=), sortable (?sort=new|old|az),
//  filterable by pricing tier (?tier=short|mid|base).
//  Returns ONLY public-safe fields — no payer addresses, no account ids.
//
//  Uses the service-role client like the other handlers (so it can also read
//  the best-effort hosted image_url off pending_mints, which is server-only).
//  The gallery works without those images: the card is deterministic from the
//  token id, so the client renders each card itself when image_url is null.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabase = adminDb();

const LIMIT_MAX = 48;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = (sp.get("q") ?? "").trim();
  const tier = sp.get("tier") ?? "";
  const sort = sp.get("sort") ?? "new";
  const limit = Math.min(LIMIT_MAX, Math.max(1, parseInt(sp.get("limit") ?? "24", 10) || 24));
  const offset = Math.max(0, parseInt(sp.get("offset") ?? "0", 10) || 0);

  let query = supabase
    .from("handles")
    .select("token_id, handle, tier, origin, created_at, image_url", { count: "exact" });

  if (q) query = query.ilike("handle", `%${q.replace(/[%_\\]/g, "")}%`); // strip LIKE wildcards
  if (tier === "short" || tier === "mid" || tier === "base") query = query.eq("tier", tier);
  if (sort === "old") query = query.order("created_at", { ascending: true });
  else if (sort === "az") query = query.order("handle_skeleton", { ascending: true });
  else query = query.order("created_at", { ascending: false });
  query = query.range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const items = (data ?? []).map((h: any) => ({
    tokenId: h.token_id,
    handle: h.handle,
    tier: h.tier as string | null,
    origin: h.origin as string,
    createdAt: h.created_at as string,
    imageUrl: (h.image_url as string) ?? null, // hosted PNG when available; else client renders it
  }));

  const total = count ?? items.length;
  const nextOffset = offset + items.length;
  return NextResponse.json({ ok: true, items, total, nextOffset, hasMore: nextOffset < total });
}
