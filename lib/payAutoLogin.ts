// =============================================================================
//  lib/payAutoLogin.ts
//  "Paying doubles as login." A completed on-chain payment from a wallet — a
//  handle mint (app/api/mint/status) or a grandfather claim (app/api/claim/status)
//  — proves control of that address, the same class of proof as pay-to-unlock,
//  which already mints a 'pay'-scope session (app/api/verify-payment). So these
//  flows shouldn't then require a separate login challenge to use the handle.
//
//  SCOPE: 'pay' ONLY. Weaker than the nonce-proven 'challenge' login (the payment
//  is public on-chain, so a race is possible — see lib/session.ts). Payout /
//  author-mutation routes MUST still require getChallengeSession().
//
//  SECURITY: only call this with an address the PAYER demonstrably controls —
//  i.e. read from the payment itself (mint payer / claim proof sender), never
//  from a client-supplied field. Callers must also ensure the caller is the payer
//  (the mint flow relies on the secret mintId; the claim flow only auto-logs-in on
//  FRESH completion, where the address comes from the just-detected proof tx, not
//  from an already-claimed re-poll keyed by the public handle).
// =============================================================================

import type { NextRequest } from "next/server";
import { resolveOrCreateAccount } from "@/lib/walletAuth";
import { setSessionCookie, verifySession, SESSION_COOKIE } from "@/lib/session";

/**
 * Issue a 'pay'-scope session for `payerAddress` on the current response. No-op on
 * an empty address. resolveOrCreateAccount also binds the freshly-held handle, so
 * the byline resolves. Guards mirror verify-payment: non-fatal (never surface a
 * session hiccup as a payment failure) and never downgrade an existing session for
 * the same account (e.g. an author already logged in via challenge).
 */
export async function autoLoginByPayment(
  req: NextRequest,
  payerAddress?: string | null,
): Promise<void> {
  const addr = typeof payerAddress === "string" ? payerAddress.trim() : "";
  if (!addr) return;
  try {
    const resolved = await resolveOrCreateAccount(addr);
    const existing = verifySession(req.cookies.get(SESSION_COOKIE)?.value);
    // Already this account (incl. a stronger 'challenge' session) — leave it be.
    if (existing && existing.accountId === resolved.accountId) return;
    await setSessionCookie(resolved.accountId, addr, "pay");
  } catch (e) {
    console.warn("[payAutoLogin] failed (non-fatal):", e instanceof Error ? e.message : e);
  }
}
