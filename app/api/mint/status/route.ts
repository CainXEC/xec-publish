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
//  Past the pay window it still looks for a TAGGED payment (or, for POW, one the
//  attribution rule says is this quote's) before expiring the row, so a
//  last-second (or slow-to-finalize) payment is delivered, not stranded.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/db";
import { verifyMintTxid, findMintPayment } from "@/lib/mintPayments";
import { pendingPollPlan, pastPayWindow } from "@/lib/mintLatePayment";
import { findOwnPowPayment } from "@/lib/mintPowAttribution";
import { processPaidMint, claimPaidOrRefund } from "@/lib/mintProcessor";
import { autoLoginByPayment } from "@/lib/payAutoLogin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabase = adminDb();
const MINT_ADDRESS = process.env.MINT_PAYMENT_ADDRESS!;

export async function GET(req: NextRequest) {
  const mintId = req.nextUrl.searchParams.get("mintId");
  const txid = req.nextUrl.searchParams.get("txid") ?? undefined;
  if (!mintId) return NextResponse.json({ ok: false, error: "missing mintId" }, { status: 400 });

  const { data: m } = await supabase.from("pending_mints").select("*").eq("id", mintId).maybeSingle();
  if (!m) return NextResponse.json({ ok: false, status: "not_found" });

  // terminal states — just report (log the minter in on a completed mint)
  if (["minted", "refunded", "failed"].includes(m.status)) {
    if (m.status === "minted") await autoLoginByPayment(req, m.payer_address);
    return NextResponse.json({ ok: true, status: m.status, childTokenId: m.child_token_id, imageUrl: m.image_url, error: m.error });
  }

  // A payment was found for this still-pending intent: hold it until Avalanche
  // finalizes, then claim the name and deliver (or refund a double-buy loser).
  const settle = async (found: { txid: string; payerAddress: string; isFinal: boolean }) => {
    // Payment seen, but hold the mint until Avalanche finalizes it. A 0-conf tx
    // can still be replaced by a conflicting double-spend; minting the NFT now
    // would let an attacker claw the payment back. Don't flip to paid — the
    // client keeps polling and we re-check finality each time (~2-3s to final).
    if (!found.isFinal) {
      return NextResponse.json({ ok: true, status: "finalizing" }, { status: 202 });
    }

    // Atomically claim the name for this payment, then deliver — or refund it if
    // an earlier payment already claimed the name (double-buy race).
    m.payer_address = found.payerAddress; // carry the proven payer for auto-login below
    const claimed = await claimPaidOrRefund(mintId, found.payerAddress, found.txid);
    // Mint done: paying from your wallet doubles as login (see autoLoginMinter).
    if (claimed.status === "minted") await autoLoginByPayment(req, m.payer_address);
    return NextResponse.json({ ok: true, ...claimed });
  };

  // awaiting payment -> look for it (lib/mintLatePayment pendingPollPlan):
  //  • XEC in the window: the mintId OP_RETURN tag, or a plain untagged send from
  //    one of the logged-in buyer's addresses.
  //  • XEC past the window: the tag ONLY — a buyer who sent at the last second, or
  //    whose payment is still finalizing, has paid, and a paid mint is delivered.
  //  • POW, in or past the window: an SLP send can't carry the tag, so it's this
  //    quote's only if the attribution rule says so (lib/mintPowAttribution) —
  //    the same rule the reconciler uses, so the two never disagree.
  // The row expires only when nothing turned up AND the window has closed.
  if (m.status === "pending") {
    const since = Math.floor(new Date(m.created_at).getTime() / 1000);
    const plan = pendingPollPlan(m, Date.now());
    let found: { txid: string; payerAddress: string; isFinal: boolean } | null;
    if (plan === "pow") {
      try {
        found = await findOwnPowPayment(supabase, m, MINT_ADDRESS, txid);
      } catch {
        // Couldn't read the chain: say nothing yet rather than expire on a failed look.
        return NextResponse.json({ ok: true, status: "awaiting_payment" });
      }
    } else if (plan === "tagged") {
      // Deliberately no expected_payers: past the window only the tag counts.
      found = txid
        ? await verifyMintTxid(txid, MINT_ADDRESS, Number(m.expected_sats), mintId)
        : await findMintPayment(MINT_ADDRESS, mintId, Number(m.expected_sats), since);
    } else {
      found = txid
        ? await verifyMintTxid(txid, MINT_ADDRESS, Number(m.expected_sats), mintId, m.expected_payers ?? [])
        : await findMintPayment(MINT_ADDRESS, mintId, Number(m.expected_sats), since, m.expected_payers ?? []);
    }

    if (found) return settle(found);
    if (!pastPayWindow(m.expires_at, Date.now())) return NextResponse.json({ ok: true, status: "awaiting_payment" });
    // Conditional, so it can never overwrite a row a concurrent poll just claimed.
    await supabase.from("pending_mints").update({ status: "expired" }).eq("id", mintId).eq("status", "pending");
    return NextResponse.json({ ok: true, status: "expired" });
  }

  // status was already 'paid' on entry (a prior poll flipped it) -> run the processor.
  const result = await processPaidMint(mintId);
  if (result.status === "minted") await autoLoginByPayment(req, m.payer_address);
  return NextResponse.json({ ok: true, ...result });
}
