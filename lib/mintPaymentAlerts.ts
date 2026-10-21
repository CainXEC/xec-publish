// =============================================================================
//  mintPaymentAlerts.ts
//  Safety net for handle-mint money. Every gap in mint matching so far (a
//  hand-sent untagged payment, a tagged payment that landed after its window,
//  POW edge cases) failed the same SILENT way: the buyer's money sat at the mint
//  wallet with no NFT and no refund, and nobody knew until someone looked by
//  hand. This matches nothing and fixes nothing — it only REPORTS, so whatever
//  the next gap is, it lights up the admin bell instead of waiting to be found.
//
//  Two kinds of money owed, both shown on /admin/mints:
//    1. Unclaimed payments — a final payment to the mint wallet that looks like a
//       purchase (any POW, or >= 1,000 XEC: small sends like login challenges
//       land here too) that NO pending_mints row has claimed (payment_txid) 30+
//       minutes after it was first seen. Recorded in mint_payment_alerts
//       (sql/mint_payment_alerts.sql) so it stays visible until an order claims
//       it (auto-resolves) or an admin dismisses it with a note.
//    2. Orders holding a payment they haven't finished with — 'stuck' (delivery
//       owed, parked for review), 'failed' with a payment but no refund (refund
//       owed, and nothing retries it), or 'paid' / 'contended' still unfinished
//       an hour after the intent. Read straight off pending_mints.
//
//  Never delivers, refunds or writes pending_mints. The scan runs on the trusted
//  5-minute cron (app/api/feed/reconcile); the bell reads the counts.
// =============================================================================

import { adminDb } from "@/lib/db";
import { scanMintWalletReceipts, type MintWalletReceipt } from "@/lib/mintPayments";

type Db = ReturnType<typeof adminDb>;

/** Below this an untagged XEC send isn't a purchase (login/address-change
 *  challenges are ~6–14 XEC). The cheapest handle is 10,000 XEC; the floor sits
 *  well under it so a short-changed purchase still shows. */
export const PURCHASE_FLOOR_SATS = 100_000; // 1,000 XEC
/** How long a payment may sit unclaimed before it counts. The buyer's tab and
 *  the 5-minute reconciler normally claim one within a few minutes. */
export const CLAIM_GRACE_SEC = 30 * 60;
/** An order still 'paid' / 'contended' this long after its intent is overdue. */
export const ORDER_OVERDUE_MS = 60 * 60 * 1000;
/** How far back each scan reads the mint wallet's history. Anything older was
 *  either flagged by an earlier run or predates this alert. */
const LOOKBACK_SEC = 7 * 24 * 3600;

const MINT_ADDRESS = process.env.MINT_PAYMENT_ADDRESS;

/** Purchase-sized: any POW, or at least PURCHASE_FLOOR_SATS of XEC. */
export function looksLikePurchase(r: Pick<MintWalletReceipt, "sats" | "powAtoms">): boolean {
  return r.powAtoms > 0n || r.sats >= PURCHASE_FLOOR_SATS;
}

/** The receipts that should raise an alert: purchase-sized, Avalanche-final,
 *  seen at least CLAIM_GRACE_SEC ago, and not claimed by any order. A receipt
 *  with no timestamp is skipped (can't tell whether its grace is over). */
export function unclaimedReceipts<T extends MintWalletReceipt>(
  receipts: T[],
  claimedTxids: Set<string>,
  nowSec: number,
): T[] {
  return receipts.filter(
    (r) =>
      looksLikePurchase(r) &&
      r.isFinal &&
      r.seenAt > 0 &&
      nowSec - r.seenAt >= CLAIM_GRACE_SEC &&
      !claimedTxids.has(r.txid),
  );
}

export type OrderAttention = "delivery_stuck" | "refund_failed" | "delivery_overdue" | "refund_overdue";

/** pending_mints statuses that can hold a payment the pipeline isn't done with. */
export const ATTENTION_STATUSES = ["stuck", "failed", "paid", "contended"] as const;

/** Why this order needs a person, or null if it doesn't. */
export function orderNeedsAttention(
  row: { status: string; payment_txid?: string | null; refund_txid?: string | null; created_at: string },
  nowMs: number,
): OrderAttention | null {
  if (row.status === "stuck") return "delivery_stuck";
  // 'failed' also marks an intent whose POW send was already used by another
  // mint — that row never took the payment (no payment_txid), so nothing's owed.
  if (row.status === "failed") return row.payment_txid && !row.refund_txid ? "refund_failed" : null;
  const overdue = nowMs - new Date(row.created_at).getTime() >= ORDER_OVERDUE_MS;
  if (row.status === "paid") return overdue ? "delivery_overdue" : null;
  if (row.status === "contended") return overdue ? "refund_overdue" : null;
  return null;
}

/** Of these txids, the ones some pending_mints row has claimed. */
async function claimedAmong(supabase: Db, txids: string[]): Promise<Set<string>> {
  const claimed = new Set<string>();
  for (let i = 0; i < txids.length; i += 50) {
    const { data, error } = await supabase
      .from("pending_mints")
      .select("payment_txid")
      .in("payment_txid", txids.slice(i, i + 50));
    if (error) throw new Error(`pending_mints: ${error.message}`);
    for (const r of data ?? []) claimed.add(r.payment_txid as string);
  }
  return claimed;
}

export interface MintPaymentAlertsResult {
  scanned: number;  // payments into the mint wallet in the lookback window
  flagged: number;  // new alerts this run
  resolved: number; // open alerts an order has since claimed
  open: number;     // alerts still open after this run
}

/** The cron step: record newly unclaimed payments, auto-resolve ones an order
 *  has since claimed. Throws on any failure (missing table, Chronik down) so the
 *  caller can log it — it must never make a gap look like "all clear". */
export async function runMintPaymentAlerts(supabase: Db = adminDb()): Promise<MintPaymentAlertsResult> {
  if (!MINT_ADDRESS) throw new Error("MINT_PAYMENT_ADDRESS not set");
  const nowSec = Math.floor(Date.now() / 1000);

  const receipts = await scanMintWalletReceipts(MINT_ADDRESS, nowSec - LOOKBACK_SEC);
  // Purchase-sized, final, past the grace period — then drop the ones claimed.
  const due = unclaimedReceipts(receipts, new Set(), nowSec);
  const claimed = await claimedAmong(supabase, due.map((r) => r.txid));
  const unclaimed = due.filter((r) => !claimed.has(r.txid));

  let flagged = 0;
  if (unclaimed.length) {
    // ignoreDuplicates: an alert already on file — open, or dismissed with a
    // note — is left exactly as it is, never re-opened.
    const { data, error } = await supabase
      .from("mint_payment_alerts")
      .upsert(
        unclaimed.map((r) => ({
          txid: r.txid,
          sats: r.sats,
          pow_atoms: r.powAtoms.toString(),
          payer_address: r.payerAddress,
          mint_id: r.mintId,
          seen_at: new Date(r.seenAt * 1000).toISOString(),
        })),
        { onConflict: "txid", ignoreDuplicates: true },
      )
      .select("txid");
    if (error) throw new Error(`mint_payment_alerts: ${error.message}`);
    flagged = data?.length ?? 0;
  }

  // Auto-resolve: an open alert whose payment an order has since claimed (the
  // reconciler caught up, or it was delivered by hand).
  const { data: openRows, error: openErr } = await supabase
    .from("mint_payment_alerts")
    .select("txid")
    .is("resolved_at", null)
    .limit(500);
  if (openErr) throw new Error(`mint_payment_alerts: ${openErr.message}`);
  const openTxids = (openRows ?? []).map((r) => r.txid as string);
  const nowClaimed = [...(await claimedAmong(supabase, openTxids))];
  if (nowClaimed.length) {
    const { error } = await supabase
      .from("mint_payment_alerts")
      .update({ resolved_at: new Date().toISOString(), resolution: "claimed" })
      .in("txid", nowClaimed)
      .is("resolved_at", null);
    if (error) throw new Error(`mint_payment_alerts: ${error.message}`);
  }

  return { scanned: receipts.length, flagged, resolved: nowClaimed.length, open: openTxids.length - nowClaimed.length };
}

/** pending_mints rows that need a person, each with its reason. */
export async function ordersNeedingAttention(supabase: Db, nowMs = Date.now()) {
  const { data, error } = await supabase
    .from("pending_mints")
    .select("id, handle, status, pay_token, expected_sats, expected_atoms, payer_address, payment_txid, refund_txid, attempts, error, created_at")
    .in("status", [...ATTENTION_STATUSES])
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) throw new Error(`pending_mints: ${error.message}`);
  return (data ?? [])
    .map((row) => ({ ...row, attention: orderNeedsAttention(row, nowMs) }))
    .filter((row) => row.attention !== null);
}

/** The admin bell's count: open unclaimed-payment alerts + orders needing a
 *  person. Before sql/mint_payment_alerts.sql has run, the alerts part reads as
 *  0 (a HEAD count on a missing table comes back count null, no error) and the
 *  orders part still counts; the cron log and /admin/mints say the table is
 *  missing. */
export async function countMintAttention(supabase: Db): Promise<number> {
  const [alerts, orders] = await Promise.all([
    supabase.from("mint_payment_alerts").select("txid", { count: "exact", head: true }).is("resolved_at", null),
    ordersNeedingAttention(supabase).catch(() => []),
  ]);
  return (alerts.error ? 0 : alerts.count ?? 0) + orders.length;
}
