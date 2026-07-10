// =============================================================================
//  app/api/handles/check/route.ts
//  GET /api/handles/check?handle=SimonCain
//  Live availability + price check for the mint page. Read-only.
//
//  Returns one of:
//    { ok:true, available:false, status:"invalid",  reason }
//    { ok:true, available:false, status:"taken" }
//    { ok:true, available:false, status:"reserved", reason }
//    { ok:true, available:false, status:"pending" }        // locked mid-mint
//    { ok:true, available:true,  handle, skeleton, tier, priceXec, priceSats, auctionOnly }
//
//  If your app is JS, rename to route.js and drop the type annotations.
//  Point the imports at wherever handleSkeleton / handlePricing live in your app.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { validateHandleSyntax, skeleton, displayHandle } from "@/lib/handleSkeleton";
import { priceForHandle } from "@/lib/handlePricing";
import { handleReservedByGrant } from "@/lib/grantReservation";

// Chronik-style: keep this on the Node runtime, not edge.
export const runtime = "nodejs";
// Never cache availability — it changes constantly.
export const dynamic = "force-dynamic";

const supabase = createClient(
  (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL)!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!, // server-only; route handlers run on the server
  { auth: { persistSession: false } }
);

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("handle") ?? "";
  if (!raw.trim()) {
    return NextResponse.json({ ok: false, error: "missing ?handle" }, { status: 400 });
  }

  // 1. syntax
  const syntaxError = validateHandleSyntax(raw);
  if (syntaxError) {
    return NextResponse.json({ ok: true, available: false, status: "invalid", reason: syntaxError });
  }

  const display = displayHandle(raw);
  const sk = skeleton(raw);

  // Run the three lookups. Any hit means unavailable. A name is only "held"
  // once a payment has landed (status='paid') — unpaid intents don't block, so
  // nobody can squat names for free by spamming intents.
  const [minted, reserved, pending, grantReserved] = await Promise.all([
    supabase.from("handles").select("token_id").eq("handle_skeleton", sk).maybeSingle(),
    supabase.from("reserved_handles").select("reason").eq("handle_skeleton", sk).maybeSingle(),
    supabase
      .from("pending_mints")
      .select("id")
      .eq("handle_skeleton", sk)
      .eq("status", "paid")
      .gt("expires_at", new Date().toISOString())
      .maybeSingle(),
    handleReservedByGrant(supabase, sk),
  ]);

  // surface DB errors rather than silently reporting "available"
  const dbErr = minted.error || reserved.error || pending.error;
  if (dbErr) {
    return NextResponse.json({ ok: false, error: "lookup failed" }, { status: 500 });
  }

  // 2. already minted?
  if (minted.data) {
    return NextResponse.json({ ok: true, available: false, status: "taken" });
  }
  // 3. reserved. Brand/staff/admin/abuse stay reserved forever. Grandfathered
  //    author names ('existing_user') are reserved for that author DURING the
  //    claim window (claimable, not publicly mintable); once the window closes
  //    and the name is still unclaimed, the reservation lifts and it's fair game.
  //    (Claimed names are already caught above as "taken".)
  if (reserved.data) {
    const reason = reserved.data.reason as string;
    if (reason === "existing_user") {
      const claimWindowEnds = process.env.CLAIM_WINDOW_ENDS ? Date.parse(process.env.CLAIM_WINDOW_ENDS) : Infinity;
      if (Date.now() < claimWindowEnds) {
        return NextResponse.json({ ok: true, available: false, status: "reserved", reason: "existing_user" });
      }
      // window closed + unclaimed -> fall through to the pricing branch as available
    } else {
      return NextResponse.json({ ok: true, available: false, status: "reserved", reason });
    }
  }
  // 3b. grandfathered: an unclaimed grant reserves the name for its owner until
  //     they use their claim code (belt-and-suspenders alongside reserved_handles).
  if (grantReserved) {
    return NextResponse.json({ ok: true, available: false, status: "reserved", reason: "grandfathered" });
  }
  // 4. held by a paid, in-progress mint
  if (pending.data) {
    return NextResponse.json({ ok: true, available: false, status: "pending" });
  }

  // available — price it
  const { tier, priceXec, priceSats, auctionOnly } = priceForHandle(display);
  return NextResponse.json({
    ok: true,
    available: true,
    handle: display,
    skeleton: sk,
    tier,
    priceXec,
    priceSats,
    auctionOnly,
  });
}
