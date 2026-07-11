// =============================================================================
//  app/api/mint/intent/route.ts
//  POST { handle }  ->  reserves the name and returns a payment request.
//  Tags the payment with mintId via op_return_raw (same convention as the
//  paywall) and matches on that — flat per-tier price, no unique-amount jitter.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { validateHandleSyntax, skeleton, displayHandle } from "@/lib/handleSkeleton";
import { priceForHandle } from "@/lib/handlePricing";
import { encodeFeedOpReturnRaw, FEED_ACTION } from "@/lib/feedProtocol";
import { rateLimit, getClientIp } from "@/lib/rateLimit";
import { mintCapSoldOut } from "@/lib/mintCap";
import { handleReservedByGrant } from "@/lib/grantReservation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabase = createClient((process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL)!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const MINT_ADDRESS = process.env.MINT_PAYMENT_ADDRESS!; // the mint wallet's ecash: address
const PAY_WINDOW_MINUTES = 15;

export async function POST(req: NextRequest) {
  // Unauthenticated endpoint that inserts a pending_mints row (payment-tracking,
  // NOT a free name lock). A name is only held once a real payment lands
  // (status='paid'), so an unpaid intent squats nothing; still throttle so a
  // flood can't bloat the table.
  const ip = getClientIp(req);
  if (!(await rateLimit(ip, 10, 60, "mint-intent"))) {
    return NextResponse.json({ ok: false, error: "Too many requests. Try again shortly." }, { status: 429 });
  }

  // Fail loudly if the mint wallet address isn't configured — otherwise the
  // BIP21 below is built with a literal "undefined" address and Cashtab can't
  // parse the deep link.
  if (!MINT_ADDRESS) {
    return NextResponse.json(
      { ok: false, error: "Minting is temporarily unavailable." },
      { status: 503 },
    );
  }

  const { handle } = await req.json().catch(() => ({}));
  if (!handle) return NextResponse.json({ ok: false, error: "missing handle" }, { status: 400 });

  const syntaxErr = validateHandleSyntax(handle);
  if (syntaxErr) return NextResponse.json({ ok: false, status: "invalid", reason: syntaxErr });

  const display = displayHandle(handle);
  const sk = skeleton(handle);
  const { tier, priceSats, auctionOnly } = priceForHandle(display);
  if (auctionOnly) return NextResponse.json({ ok: false, status: "auction", reason: "premium name — auction only" });

  // availability (mirrors the check endpoint). A PAID hold — someone whose
  // payment has landed and is being minted — blocks a new intent; unpaid
  // pending rows do not (no free squat).
  const nowIso = new Date().toISOString();
  const [{ data: taken }, { data: reserved }, { data: paidHold }, grantReserved] = await Promise.all([
    supabase.from("handles").select("token_id").eq("handle_skeleton", sk).limit(1).maybeSingle(),
    supabase.from("reserved_handles").select("reason").eq("handle_skeleton", sk).limit(1).maybeSingle(),
    supabase.from("pending_mints").select("id").eq("handle_skeleton", sk).eq("status", "paid").gt("expires_at", nowIso).limit(1).maybeSingle(),
    handleReservedByGrant(supabase, sk),
  ]);
  if (taken) return NextResponse.json({ ok: false, status: "taken" });
  if (reserved) return NextResponse.json({ ok: false, status: "reserved", reason: reserved.reason });
  if (grantReserved) return NextResponse.json({ ok: false, status: "reserved", reason: "grandfathered" });
  if (paidHold) return NextResponse.json({ ok: false, status: "pending", reason: "name is being minted right now" });

  // Fail fast if the collection is live and sold out — don't take a payment we'd
  // only have to refund. Advisory only; the authoritative cap check runs in
  // mintProcessor under the global mint_lock. No-op pre-launch.
  if (await mintCapSoldOut()) return NextResponse.json({ ok: false, status: "sold_out", reason: "The collection is sold out." });

  // flat per-tier price — disambiguation is now the op_return_raw (mintId), not amount.
  const expectedSats = priceSats;
  // Payment window (not a name hold): pay before this or the quote goes stale.
  const expiresAt = new Date(Date.now() + PAY_WINDOW_MINUTES * 60_000).toISOString();

  // Create the payment-tracking row. Multiple unpaid intents for the same name
  // may coexist now (the name is only held once one is paid); a real DB error is
  // a 500, not a "someone else is minting" signal.
  const { data: row, error } = await supabase
    .from("pending_mints")
    .insert({ handle: display, handle_skeleton: sk, price_sats: priceSats, expected_sats: expectedSats, status: "pending", expires_at: expiresAt })
    .select("id")
    .single();

  if (error || !row) {
    // Post-migration this only fires on a genuine DB error. Pre-migration, the
    // legacy partial unique index still rejects a second concurrent intent for
    // the same skeleton — treat that as "being minted" (graceful, old behavior)
    // rather than a hard error, so the rollout order doesn't matter.
    return NextResponse.json({ ok: false, status: "pending", reason: "name is being minted right now" });
  }

  // Tag the payment with mintId (UUID) inside the POWR envelope (OP_9 = mint), so
  // the 4-byte LOKAD leads the OP_RETURN and Chronik indexes it under POWR — the
  // old bare-UUID push had no LOKAD and was invisible to chronik.lokadId(). Same
  // UUID, just wrapped; the verifier dual-accepts the legacy layout during rollout.
  // encodeFeedOpReturnRaw requires a 36-char UUID nonce; pending_mints.id is uuid.
  let opReturnRaw: string;
  try {
    opReturnRaw = encodeFeedOpReturnRaw({ action: FEED_ACTION.HANDLE, nonce: row.id });
  } catch {
    return NextResponse.json(
      { ok: false, error: "pending_mints.id must be a uuid for op_return tagging" },
      { status: 500 },
    );
  }

  const amountXec = (expectedSats / 100).toFixed(2);
  // Raw, UN-encoded BIP21. The client wraps this ONCE in encodeURIComponent for the
  // Cashtab deep link: https://cashtab.com/#/send?bip21=<encoded>
  const bip21 = `${MINT_ADDRESS}?amount=${amountXec}&op_return_raw=${opReturnRaw}`;

  return NextResponse.json({
    ok: true,
    mintId: row.id,
    handle: display,
    tier,
    amountXec,
    expectedSats,
    address: MINT_ADDRESS,
    bip21Url: bip21,
    opReturnRaw,
    expiresAt,
  });
}
