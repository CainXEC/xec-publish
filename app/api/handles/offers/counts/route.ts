// =============================================================================
//  app/api/handles/offers/counts/route.ts — open-offer counts for a page of
//  gallery cards, in one round trip. Public: counts only, never amounts.
//
//  POST { tokenIds: string[] }  ->  { ok, counts: { [tokenId]: number } }
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabase = createClient(
  (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL)!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const MAX_IDS = 96; // two gallery pages

export async function POST(req: NextRequest) {
  let body: { tokenIds?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad request" }, { status: 400 });
  }

  const tokenIds = Array.isArray(body.tokenIds)
    ? body.tokenIds
        .map((t) => String(t).toLowerCase())
        .filter((t) => /^[0-9a-f]{64}$/.test(t))
        .slice(0, MAX_IDS)
    : [];
  if (tokenIds.length === 0) {
    return NextResponse.json({ ok: true, counts: {} });
  }

  const { data, error } = await supabase
    .from("handle_offers")
    .select("token_id")
    .in("token_id", tokenIds)
    .eq("status", "open");

  if (error) {
    // Table not applied yet — the gallery just shows no interest chips.
    return NextResponse.json({ ok: true, counts: {} });
  }

  const counts: Record<string, number> = {};
  for (const row of (data ?? []) as Array<{ token_id: string }>) {
    counts[row.token_id] = (counts[row.token_id] ?? 0) + 1;
  }
  return NextResponse.json({ ok: true, counts });
}
