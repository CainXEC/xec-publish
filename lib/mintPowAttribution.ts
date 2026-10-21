// =============================================================================
//  mintPowAttribution.ts
//  Which handle a POW payment is for. An SLP send can't carry the mintId tag the
//  XEC path matches on, so a POW payment says only WHO paid (one of the buyer's
//  proven addresses) and HOW MUCH. The old matcher took "any POW send from this
//  wallet since the intent opened" — fine for one quote, wrong for two:
//    • an abandoned quote stayed 'pending' (no tab left to expire it) and the
//      reconciler could hand it the payment the buyer later made for ANOTHER
//      name, minting the wrong handle;
//    • a payment that landed (or finalized) after the 15-minute window found its
//      row already 'expired', and nothing looked at expired POW rows again — no
//      NFT, no refund.
//
//  The rule, used by both the status poll and the reconciler so they agree:
//  a POW payment belongs to one of the payer's own POW quotes that was open
//  when it was sent — opened before it (±2 min clock skew) and closed no more
//  than POW_LATE_GRACE after its window — whose price it covers, and that no
//  other payment has claimed ('pending' or 'expired' with no payment_txid).
//    • One such quote → that one.
//    • Several → the one at the payment's EXACT price opened last BEFORE the
//      payment (the quote the buyer's tab was showing when they paid; tier
//      prices differ, so the amount usually settles it). The clock-skew
//      allowance never lets a quote opened just AFTER the payment — the buyer
//      starting their next purchase — win over the one they paid.
//    • Several, none at the exact price → nobody guesses: left for a person
//      (the unclaimed-payment alert, lib/mintPaymentAlerts, flags it).
//  The rule (attributePowPayment) is pure so it's testable; the two helpers
//  below it do the DB/Chronik reads around it.
// =============================================================================

import { adminDb } from "@/lib/db";
import { readMintWalletReceiptByTxid, scanMintWalletReceipts, type MintWalletReceipt } from "@/lib/mintPayments";

type Db = ReturnType<typeof adminDb>;

/** How long after a POW quote's window closes a payment still counts for it
 *  (Cashtab left open on the send screen; slow finality). Later → a person. */
export const POW_LATE_GRACE_SEC = 30 * 60;
/** Clock skew allowed between our timestamps and Chronik's first-seen time. */
export const POW_SKEW_SEC = 120;

export interface PowIntent {
  id: string;
  status: string;
  created_at: string;
  expires_at: string;
  expected_atoms: number | string | null;
  payment_txid?: string | null;
}

function atomsOf(v: unknown): bigint {
  try {
    return BigInt(v as string | number | bigint);
  } catch {
    return 0n;
  }
}

/** The id of the POW quote this payment is for, or null (see the header). */
export function attributePowPayment(
  payment: { seenAt: number; powAtoms: bigint },
  intents: PowIntent[],
): string | null {
  if (!payment.seenAt || payment.powAtoms <= 0n) return null;
  const t = payment.seenAt * 1000;
  const fits = intents.filter((r) => {
    if (r.status !== "pending" && r.status !== "expired") return false; // paid/minted/failed: not open
    if (r.payment_txid) return false; // already claimed by another payment
    const price = atomsOf(r.expected_atoms);
    if (price <= 0n || payment.powAtoms < price) return false;
    const opened = new Date(r.created_at).getTime() - POW_SKEW_SEC * 1000;
    const closed = new Date(r.expires_at).getTime() + POW_LATE_GRACE_SEC * 1000;
    return t >= opened && t <= closed;
  });
  if (fits.length <= 1) return fits[0]?.id ?? null;
  const exact = fits.filter((r) => atomsOf(r.expected_atoms) === payment.powAtoms);
  if (!exact.length) return null;
  const openedBefore = exact.filter((r) => new Date(r.created_at).getTime() <= t);
  return latestOpened(openedBefore.length ? openedBefore : exact).id;
}

function latestOpened(rows: PowIntent[]): PowIntent {
  return rows.reduce((a, b) => (new Date(b.created_at).getTime() > new Date(a.created_at).getTime() ? b : a));
}

/** The earliest created_at a quote could have and still fit a payment seen at
 *  `seenAt` (its window is 15 min + POW_LATE_GRACE). Narrows the DB read. */
export function powIntentsOpenedAfter(seenAt: number, payWindowSec = 15 * 60): string {
  return new Date((seenAt - payWindowSec - POW_LATE_GRACE_SEC - POW_SKEW_SEC) * 1000).toISOString();
}

/** A POW payment, read off the chain, with a known sender. */
export type PowReceipt = MintWalletReceipt & { payerAddress: string };

/** The quote a POW payment is for, read from the payer's own POW quotes around
 *  the time it was sent — or null, including when an order already claimed it.
 *  Shared by the status poll and the reconciler so both pick the same quote. */
export async function powIntentForPayment(supabase: Db, p: PowReceipt): Promise<PowIntent | null> {
  if (!p.seenAt || p.powAtoms <= 0n) return null;
  const { data: used } = await supabase.from("pending_mints").select("id").eq("payment_txid", p.txid).limit(1).maybeSingle();
  if (used) return null;
  const { data: rows, error } = await supabase
    .from("pending_mints")
    .select("id, status, created_at, expires_at, expected_atoms, payment_txid")
    .eq("pay_token", "pow")
    .contains("expected_payers", [p.payerAddress])
    .gte("created_at", powIntentsOpenedAfter(p.seenAt))
    .lte("created_at", new Date((p.seenAt + POW_SKEW_SEC) * 1000).toISOString())
    .limit(50);
  if (error) throw new Error(`pending_mints: ${error.message}`);
  const id = attributePowPayment(p, (rows ?? []) as PowIntent[]);
  return ((rows ?? []) as PowIntent[]).find((r) => r.id === id) ?? null;
}

/** For the status poll: the POW payment that is THIS quote's, if one has landed
 *  (final or not — the caller holds for finality). Looks at the newest mint-
 *  wallet txs since the quote opened, or just `txid` (the "I've paid" box).
 *  Throws if Chronik can't be read, so the caller doesn't expire on a failed look. */
export async function findOwnPowPayment(
  supabase: Db,
  intent: { id: string; created_at: string; expected_payers?: string[] | null },
  mintAddress: string,
  txid?: string,
): Promise<PowReceipt | null> {
  const payers = intent.expected_payers ?? [];
  const since = Math.floor(new Date(intent.created_at).getTime() / 1000) - POW_SKEW_SEC;
  const receipts = txid
    ? [await readMintWalletReceiptByTxid(txid, mintAddress)]
    : await scanMintWalletReceipts(mintAddress, since, 1, 25);
  for (const r of receipts) {
    if (!r || r.powAtoms <= 0n || !r.payerAddress || !payers.includes(r.payerAddress)) continue;
    const p = r as PowReceipt;
    if ((await powIntentForPayment(supabase, p))?.id === intent.id) return p;
  }
  return null;
}
