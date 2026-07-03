// =============================================================================
//  app/api/mint/intent/route.ts
//  POST { handle }  ->  reserves the name and returns a payment request.
//  Creates the pending_mints lock (unique-amount) and a BIP21 to the mint addr.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { validateHandleSyntax, skeleton, displayHandle } from "@/lib/handleSkeleton";
import { priceForHandle } from "@/lib/handlePricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabase = createClient((process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL)!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const MINT_ADDRESS = process.env.MINT_PAYMENT_ADDRESS!; // the mint wallet's ecash: address
const LOCK_MINUTES = 15;

export async function POST(req: NextRequest) {
  const { handle } = await req.json().catch(() => ({}));
  if (!handle) return NextResponse.json({ ok: false, error: "missing handle" }, { status: 400 });

  const syntaxErr = validateHandleSyntax(handle);
  if (syntaxErr) return NextResponse.json({ ok: false, status: "invalid", reason: syntaxErr });

  const display = displayHandle(handle);
  const sk = skeleton(handle);
  const { tier, priceSats, auctionOnly } = priceForHandle(display);
  if (auctionOnly) return NextResponse.json({ ok: false, status: "auction", reason: "premium name — auction only" });

  // availability (mirrors the check endpoint)
  const [{ data: taken }, { data: reserved }] = await Promise.all([
    supabase.from("handles").select("token_id").eq("handle_skeleton", sk).maybeSingle(),
    supabase.from("reserved_handles").select("reason").eq("handle_skeleton", sk).maybeSingle(),
  ]);
  if (taken) return NextResponse.json({ ok: false, status: "taken" });
  if (reserved) return NextResponse.json({ ok: false, status: "reserved", reason: reserved.reason });

  // unique amount so auto-detection is unambiguous (price + 0..99 sats)
  const expectedSats = priceSats + Math.floor(Math.random() * 100);
  const expiresAt = new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString();

  // create the lock. The partial unique index on skeleton rejects a double-lock.
  const { data: row, error } = await supabase
    .from("pending_mints")
    .insert({ handle: display, handle_skeleton: sk, price_sats: priceSats, expected_sats: expectedSats, status: "pending", expires_at: expiresAt })
    .select("id")
    .single();

  if (error) {
    // unique-violation => someone is already minting this skeleton
    return NextResponse.json({ ok: false, status: "pending", reason: "name is being minted right now" });
  }

  const amountXec = (expectedSats / 100).toFixed(2);
  const bip21 = `${MINT_ADDRESS}?amount=${amountXec}`;
  return NextResponse.json({
    ok: true,
    mintId: row.id,
    handle: display,
    tier,
    amountXec,
    expectedSats,
    address: MINT_ADDRESS,
    bip21Url: bip21,
    expiresAt,
  });
}
