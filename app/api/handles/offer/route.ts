// =============================================================================
//  app/api/handles/offer/route.ts — place or withdraw an offer on a handle.
//
//  POST { tokenId, action: "place" | "withdraw", amountXec?: number | null }
//
//  Login-gated (pow_session): the 5.5 XEC challenge login is the anti-spam
//  floor for v1 — offers themselves are free. Amounts are PRIVATE: stored
//  here, surfaced only to the current holder via /api/handles/offers.
//  One live offer per (handle, bidder); re-placing updates the same row.
//
//  On place, the current holder's account (if any) gets a bell notification
//  ("@bidder made an offer on @handle") — best-effort, never blocks the offer.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAuthedAccount } from "@/lib/authHelpers";
import { holderAccountIdForToken } from "@/lib/handleOffers";
import { recordFeedNotification } from "@/lib/feedNotifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabase = createClient(
  (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL)!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

// Sanity bounds for a named amount: 1 XEC .. 1 trillion XEC, in sats (x100).
const MIN_SATS = 100;
const MAX_SATS = 100_000_000_000_000;

export async function POST(req: NextRequest) {
  const acct = await getAuthedAccount();
  if (!acct) {
    return NextResponse.json({ ok: false, error: "log in to make an offer" }, { status: 401 });
  }

  let body: { tokenId?: string; action?: string; amountXec?: number | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad request" }, { status: 400 });
  }

  const tokenId = String(body.tokenId ?? "").toLowerCase();
  const action = body.action === "withdraw" ? "withdraw" : "place";
  if (!/^[0-9a-f]{64}$/.test(tokenId)) {
    return NextResponse.json({ ok: false, error: "bad token id" }, { status: 400 });
  }

  const { data: h } = await supabase
    .from("handles")
    .select("token_id, handle")
    .eq("token_id", tokenId)
    .maybeSingle();
  if (!h) {
    return NextResponse.json({ ok: false, error: "unknown handle" }, { status: 404 });
  }

  if (action === "withdraw") {
    const { error } = await supabase
      .from("handle_offers")
      .update({ status: "withdrawn", updated_at: new Date().toISOString() })
      .eq("token_id", tokenId)
      .eq("bidder_account_id", acct.accountId);
    if (error) {
      return NextResponse.json({ ok: false, error: "couldn't withdraw the offer" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, mine: null });
  }

  // ---- place / update ----
  let amountSats: number | null = null;
  if (body.amountXec != null) {
    const n = Number(body.amountXec);
    if (!Number.isFinite(n) || n <= 0) {
      return NextResponse.json({ ok: false, error: "bad amount" }, { status: 400 });
    }
    amountSats = Math.round(n * 100);
    if (amountSats < MIN_SATS || amountSats > MAX_SATS) {
      return NextResponse.json(
        { ok: false, error: "amount must be between 1 XEC and 1,000,000,000,000 XEC" },
        { status: 400 }
      );
    }
  }

  // You can't court your own handle.
  const holderAccountId = await holderAccountIdForToken(supabase, tokenId);
  if (holderAccountId && holderAccountId === acct.accountId) {
    return NextResponse.json({ ok: false, error: "you hold this handle" }, { status: 400 });
  }

  // Ring the holder's bell only when something changed: a fresh offer, a
  // revived withdrawn one, or a new amount — not every idempotent re-submit.
  const { data: existing } = await supabase
    .from("handle_offers")
    .select("status, amount_sats")
    .eq("token_id", tokenId)
    .eq("bidder_account_id", acct.accountId)
    .maybeSingle();
  const shouldNotify =
    !existing || existing.status !== "open" || existing.amount_sats !== amountSats;

  const { error } = await supabase.from("handle_offers").upsert(
    {
      token_id: tokenId,
      handle: h.handle,
      bidder_account_id: acct.accountId,
      amount_sats: amountSats,
      status: "open",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "token_id,bidder_account_id" }
  );
  if (error) {
    // Most likely: sql/handle_offers.sql not applied yet.
    console.error("[handle-offer] upsert failed", error.message);
    return NextResponse.json({ ok: false, error: "offers aren't available yet" }, { status: 503 });
  }

  // Bell for the holder — best-effort, never blocks the offer itself.
  // recordFeedNotification no-ops when the holder has no account.
  if (shouldNotify) {
    await recordFeedNotification(supabase, {
      recipientAccountId: holderAccountId,
      actorAccountId: acct.accountId,
      actorIdentity: acct.identity,
      type: "offer",
      postTxid: tokenId,
    });
  }

  return NextResponse.json({
    ok: true,
    mine: { amountXec: amountSats == null ? null : amountSats / 100 },
  });
}
