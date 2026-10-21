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
//       to its row, record the proven payer, flip to paid, and deliver. A plain
//       send with no tag (copy-address) is paired with the payer's own open
//       intent instead — only when exactly one fits (see mintPayments).
//
//  LATE PAYMENTS: a tagged payment whose row already EXPIRED (sent at the last
//  second, or finality landed after the window) reopens the row to 'pending' and
//  is claimed the same way in pass B (see lib/mintLatePayment).
//
//  Bounded per invocation (mints are serialized and slow) — the backlog drains
//  over successive runs.
// =============================================================================

import { adminDb } from "@/lib/db";
import { scanMintPayments, findPowMintPayment, pickUntaggedMintRow, type ScannedMintPayment } from "@/lib/mintPayments";
import { processPaidMint, claimPaidOrRefund, refundContended } from "@/lib/mintProcessor";
import { taggedPaymentPlan } from "@/lib/mintLatePayment";

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
  reopened: number;      // pass B: of those, late payments whose row had expired
  delivered: number;     // mints that completed this run
  refunded: number;      // refunds issued (genuine unavailability + double-buy losers)
  contendedRetried: number; // pass C: contended losers whose refund we retried
  stuck: number;         // paid rows currently parked for manual review
  skippedBusy: boolean;  // hit the per-run work cap (more remain)
}

/** The one open XEC intent an untagged payment belongs to: one the PAYER made while
 *  logged in (their address is in expected_payers), whose pay window contains the
 *  payment. Skips a payment some mint already consumed. Ambiguous → null. */
async function untaggedMintRowFor(supabase: ReturnType<typeof adminDb>, p: ScannedMintPayment): Promise<string | null> {
  if (!p.seenAt) return null; // can't place it in a pay window
  const { data: used } = await supabase.from("pending_mints").select("id").eq("payment_txid", p.txid).limit(1).maybeSingle();
  if (used) return null;
  // Narrow to intents whose window could contain the payment (±2 min skew), so a
  // pile of abandoned 'pending' rows can't crowd the right one out of the limit.
  const skewMs = 120_000;
  const { data: rows } = await supabase
    .from("pending_mints")
    .select("id, expected_sats, created_at, expires_at")
    .eq("status", "pending")
    .eq("pay_token", "xec")
    .contains("expected_payers", [p.payerAddress])
    .lte("created_at", new Date(p.seenAt * 1000 + skewMs).toISOString())
    .gte("expires_at", new Date(p.seenAt * 1000 - skewMs).toISOString())
    .limit(10);
  return pickUntaggedMintRow(rows ?? [], p)?.id ?? null;
}

export async function runMintReconcile(): Promise<MintReconcileResult> {
  const supabase = adminDb();
  const out: MintReconcileResult = { paidRetried: 0, detected: 0, reopened: 0, delivered: 0, refunded: 0, contendedRetried: 0, stuck: 0, skippedBusy: false };
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
      if (!p.isFinal) continue; // not yet final
      if (!p.mintId) {
        // A plain send (copy-address / a wallet that drops op_return_raw): pair it
        // with the payer's own open intent, if exactly one fits. Foreign OP_RETURNs skip.
        const rowId = p.untagged ? await untaggedMintRowFor(supabase, p) : null;
        if (!rowId) continue;
        budget -= 1;
        out.detected += 1;
        tally((await claimPaidOrRefund(rowId, p.payerAddress, p.txid)).status);
        continue;
      }
      const { data: row } = await supabase
        .from("pending_mints")
        .select("id, status, expected_sats, pay_token")
        .eq("id", p.mintId)
        .maybeSingle();
      // pending → claim; expired (a late payment) → reopen, then claim; anything
      // else skips (paid rows are pass A's, terminal rows are done, underpaid).
      const plan = taggedPaymentPlan(row, p.sats);
      if (plan === "skip") continue;
      if (plan === "reopen") {
        // Conditional on 'expired': if the row changed since we read it, leave
        // it — the next run re-reads it.
        const { data: reopened } = await supabase
          .from("pending_mints")
          .update({ status: "pending" })
          .eq("id", p.mintId)
          .eq("status", "expired")
          .select("id");
        if (!reopened?.length) continue;
        out.reopened += 1;
      }

      // Atomically claim the name for this payment and deliver — or refund it if
      // an earlier payment already claimed the name (double-buy loser).
      budget -= 1;
      out.detected += 1;
      tally((await claimPaidOrRefund(p.mintId, p.payerAddress, p.txid)).status);
    }
  }

  // ---- Pass B2: undetected POW (SLP) payments for still-'pending' pow rows ----
  // POW sends carry no mintId tag, so they aren't in scanMintPayments; match each
  // open pow intent by its recorded proven-payer set (the closed-tab case).
  if (budget > 0 && MINT_ADDRESS) {
    const cutoff = new Date(Date.now() - SCAN_LOOKBACK_HOURS * 3600 * 1000).toISOString();
    const { data: powRows } = await supabase
      .from("pending_mints")
      .select("id, expected_atoms, expected_payers, created_at")
      .eq("status", "pending")
      .eq("pay_token", "pow")
      .gte("created_at", cutoff)
      .limit(MAX_DELIVERIES_PER_RUN * 2);
    for (const row of powRows ?? []) {
      if (budget <= 0) { out.skippedBusy = true; break; }
      const since = Math.floor(new Date(row.created_at as string).getTime() / 1000);
      const found = await findPowMintPayment(
        MINT_ADDRESS,
        BigInt((row.expected_atoms as number) ?? 0),
        (row.expected_payers as string[]) ?? [],
        since,
      );
      if (!found || !found.isFinal) continue;
      budget -= 1;
      out.detected += 1;
      tally((await claimPaidOrRefund(row.id as string, found.payerAddress, found.txid)).status);
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
