// =============================================================================
//  mintReconcile.ts
//  Server-side delivery sweep for handle mints. Mint completion used to depend
//  entirely on the buyer's browser polling /api/mint/status — so if they paid and
//  closed the tab, the mint was never processed (no NFT, no refund; the money
//  just sat at the mint wallet). This runs on a schedule and finishes those.
//
//  Two passes, both routed through processPaidMint (lock-serialized, idempotent,
//  double-mint-safe, retry-not-refund):
//    A. Rows already 'paid' but not delivered — a mint whose processing died or
//       is mid-retry. Re-run them (oldest attempt first).
//    B. Payments on-chain to the mint address whose 'pending' row was never
//       flipped to paid (the closed-tab case): match each tx's OP_RETURN mintId
//       to its row, record the proven payer, flip to paid, and deliver.
//
//  Bounded per invocation (mints are serialized and slow) — the backlog drains
//  over successive runs.
// =============================================================================

import { adminDb } from "@/lib/db";
import { scanMintPayments } from "@/lib/mintPayments";
import { processPaidMint, claimPaidOrRefund, refundContended } from "@/lib/mintProcessor";

const MINT_ADDRESS = process.env.MINT_PAYMENT_ADDRESS;

// Cap the actual mint work per run so we stay well inside the function timeout;
// the rest is picked up on the next pass.
const MAX_DELIVERIES_PER_RUN = 6;
// How far back to scan the mint wallet's history for undetected payments.
const SCAN_LOOKBACK_HOURS = 48;
const SCAN_LIMIT = 50;

export interface MintReconcileResult {
  paidRetried: number;   // pass A: 'paid' rows re-run
  detected: number;      // pass B: on-chain payments claimed pending→paid
  delivered: number;     // mints that completed this run
  refunded: number;      // refunds issued (genuine unavailability + double-buy losers)
  contendedRetried: number; // pass C: contended losers whose refund we retried
  stuck: number;         // paid rows currently parked for manual review
  skippedBusy: boolean;  // hit the per-run work cap (more remain)
}

export async function runMintReconcile(): Promise<MintReconcileResult> {
  const supabase = adminDb();
  const out: MintReconcileResult = { paidRetried: 0, detected: 0, delivered: 0, refunded: 0, contendedRetried: 0, stuck: 0, skippedBusy: false };
  let budget = MAX_DELIVERIES_PER_RUN;

  const tally = (status: string) => {
    if (status === "minted") out.delivered += 1;
    else if (status === "refunded" || status === "failed") out.refunded += 1;
    else if (status === "stuck") out.stuck += 1;
  };

  // ---- Pass A: 'paid' rows that still owe a delivery (oldest attempt first) ----
  const { data: paidRows } = await supabase
    .from("pending_mints")
    .select("id")
    .eq("status", "paid")
    .order("last_attempt_at", { ascending: true, nullsFirst: true })
    .limit(MAX_DELIVERIES_PER_RUN * 2);
  for (const row of paidRows ?? []) {
    if (budget <= 0) { out.skippedBusy = true; break; }
    budget -= 1;
    out.paidRetried += 1;
    tally((await processPaidMint(row.id as string)).status);
  }

  // ---- Pass B: on-chain payments whose 'pending' row was never claimed ----
  if (budget > 0 && MINT_ADDRESS) {
    const since = Math.floor(Date.now() / 1000) - SCAN_LOOKBACK_HOURS * 3600;
    const payments = await scanMintPayments(MINT_ADDRESS, since, SCAN_LIMIT);
    for (const p of payments) {
      if (budget <= 0) { out.skippedBusy = true; break; }
      if (!p.mintId || !p.isFinal) continue; // untagged/foreign, or not yet final
      const { data: row } = await supabase
        .from("pending_mints")
        .select("id, status, expected_sats")
        .eq("id", p.mintId)
        .maybeSingle();
      if (!row || row.status !== "pending") continue; // paid rows handled in pass A; terminal rows skip
      if (p.sats < Number(row.expected_sats)) continue; // underpaid

      // Atomically claim the name for this payment and deliver — or refund it if
      // an earlier payment already claimed the name (double-buy loser).
      budget -= 1;
      out.detected += 1;
      tally((await claimPaidOrRefund(p.mintId, p.payerAddress, p.txid)).status);
    }
  }

  // ---- Pass C: contended losers whose inline refund couldn't complete ----
  if (budget > 0) {
    const { data: contended } = await supabase
      .from("pending_mints")
      .select("id")
      .eq("status", "contended")
      .limit(MAX_DELIVERIES_PER_RUN);
    for (const row of contended ?? []) {
      if (budget <= 0) { out.skippedBusy = true; break; }
      budget -= 1;
      out.contendedRetried += 1;
      tally((await refundContended(row.id as string)).status);
    }
  }

  // Visibility: how many paid mints are parked for manual review right now.
  const { count } = await supabase
    .from("pending_mints")
    .select("id", { count: "exact", head: true })
    .eq("status", "stuck");
  out.stuck = count ?? out.stuck;

  return out;
}
