// =============================================================================
//  app/api/mint/status/route.ts
//  GET ?mintId=...            -> auto-detect payment, then process
//  GET ?mintId=...&txid=...   -> manual "I've paid" path (verify a specific tx)
//
//  The browser polls this every ~2s (like your unlock check-unlock). It:
//   1. reads the pending mint
//   2. if still awaiting payment, looks for it on-chain (auto or by txid),
//      matching on the op_return_raw (mintId) tag instead of a unique amount
//   3. once paid, records payer + flips to 'paid', then runs the serialized
//      processor (mint -> record -> image -> or auto-refund on failure)
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyMintTxid, findMintPayment } from "@/lib/mintPayments";
import { processPaidMint } from "@/lib/mintProcessor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabase = createClient((process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL)!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const MINT_ADDRESS = process.env.MINT_PAYMENT_ADDRESS!;

export async function GET(req: NextRequest) {
  const mintId = req.nextUrl.searchParams.get("mintId");
  const txid = req.nextUrl.searchParams.get("txid") ?? undefined;
  if (!mintId) return NextResponse.json({ ok: false, error: "missing mintId" }, { status: 400 });

  const { data: m } = await supabase.from("pending_mints").select("*").eq("id", mintId).maybeSingle();
  if (!m) return NextResponse.json({ ok: false, status: "not_found" });

  // terminal states — just report
  if (["minted", "refunded", "failed"].includes(m.status)) {
    return NextResponse.json({ ok: true, status: m.status, childTokenId: m.child_token_id, imageUrl: m.image_url, error: m.error });
  }

  // expired lock
  if (m.status === "pending" && new Date(m.expires_at).getTime() < Date.now()) {
    await supabase.from("pending_mints").update({ status: "expired" }).eq("id", mintId);
    return NextResponse.json({ ok: true, status: "expired" });
  }

  // awaiting payment -> look for it (matched by the mintId OP_RETURN tag)
  if (m.status === "pending") {
    const since = Math.floor(new Date(m.created_at).getTime() / 1000);
    const found = txid
      ? await verifyMintTxid(txid, MINT_ADDRESS, Number(m.expected_sats), mintId)
      : await findMintPayment(MINT_ADDRESS, mintId, Number(m.expected_sats), since);

    if (!found) return NextResponse.json({ ok: true, status: "awaiting_payment" });

    // Payment seen, but hold the mint until Avalanche finalizes it. A 0-conf tx
    // can still be replaced by a conflicting double-spend; minting the NFT now
    // would let an attacker claw the payment back. Don't flip to paid — the
    // client keeps polling and we re-check finality each time (~2-3s to final).
    if (!found.isFinal) {
      return NextResponse.json({ ok: true, status: "finalizing" }, { status: 202 });
    }

    // record payer (delivery address) + flip to paid (guard against double-flip)
    await supabase
      .from("pending_mints")
      .update({ status: "paid", payer_address: found.payerAddress, payment_txid: found.txid })
      .eq("id", mintId)
      .eq("status", "pending");
  }

  // paid -> run the serialized processor (mints, records, or auto-refunds)
  const result = await processPaidMint(mintId);
  return NextResponse.json({ ok: true, ...result });
}
