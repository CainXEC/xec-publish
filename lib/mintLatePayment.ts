// =============================================================================
//  mintLatePayment.ts
//  What to do with a mint payment that lands AFTER its intent's 15-minute pay
//  window. A paid mint is delivered, never dropped (refund only when delivery is
//  impossible) — so "the window closed" must never strand a payment that cleared.
//
//  Two places used to: the status poll flipped a 'pending' row to 'expired' on
//  its first tick past expires_at, BEFORE looking for the payment, and the
//  reconciler only claimed rows still 'pending'. A buyer who sent at the last
//  second (or whose payment was still finalizing) ended up with an 'expired' row
//  and their money parked at the mint wallet: no NFT, no refund.
//
//  For XEC the grace is TAG-ONLY on purpose. Past the window, only the mintId tag
//  in the OP_RETURN ties a tx to THIS intent beyond doubt; an untagged XEC send is
//  matched by sender and could just as well belong to a newer intent from the
//  same wallet, so it gets no grace. A POW (SLP) send can never carry the tag, so
//  POW has its own rule for which quote a payment is for — the same in and past
//  the window (lib/mintPowAttribution.ts).
//  Pure (no DB, no Chronik) so the rules are testable.
// =============================================================================

type IntentRow = {
  status: string;
  pay_token?: string | null;
  expected_sats?: number | string | null;
};

/** Has this intent's pay window closed? (An unparseable expires_at counts as open,
 *  same as the old `<` check.) */
export function pastPayWindow(expiresAt: string, nowMs: number): boolean {
  return new Date(expiresAt).getTime() < nowMs;
}

/** True for an intent paid in POW (SLP) — matched by sender, never by tag. */
function isPowIntent(row: { pay_token?: string | null }): boolean {
  return row.pay_token === "pow";
}

/** How the status poll should look for a 'pending' row's payment (the row
 *  expires only if none turns up AND the window has closed):
 *   'match'  — XEC inside the window: the normal matcher (tag, or a plain send
 *              from the buyer's own wallet).
 *   'tagged' — XEC, window closed: look ONLY for a tx tagged with this mintId.
 *   'pow'    — POW, in or past the window: a POW send this quote's attribution
 *              rule (lib/mintPowAttribution) says is its own. */
export function pendingPollPlan(row: IntentRow & { expires_at: string }, nowMs: number): "match" | "tagged" | "pow" {
  if (isPowIntent(row)) return "pow";
  return pastPayWindow(row.expires_at, nowMs) ? "tagged" : "match";
}

/** What the reconciler should do with the intent row a FINAL, mintId-tagged
 *  payment points at:
 *   'claim'  — still 'pending': claim + deliver (claimPaidOrRefund).
 *   'reopen' — 'expired' XEC intent (the late payment): flip it back to
 *              'pending' with a conditional update, then claim. claimPaidOrRefund
 *              refunds if the name was taken in the meantime.
 *   'skip'   — no row, underpaid, already paid (pass A), terminal, or an
 *              expired POW intent (the app never sends a tagged XEC tx for one,
 *              and its refund path would return POW, not the XEC received). */
export function taggedPaymentPlan(
  row: IntentRow | null | undefined,
  paidSats: number,
): "claim" | "reopen" | "skip" {
  if (!row) return "skip";
  if (paidSats < Number(row.expected_sats)) return "skip"; // underpaid
  if (row.status === "pending") return "claim";
  if (row.status === "expired" && !isPowIntent(row)) return "reopen";
  return "skip";
}
