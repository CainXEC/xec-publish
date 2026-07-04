// =============================================================================
//  lib/session.ts
//  Wallet-auth session primitive. HMAC-signed cookie, same construction as
//  lib/cookieSigner.js (COOKIE_SECRET, HMAC-SHA256, "{payload}.{hexsig}",
//  timingSafeEqual verify) — but the payload is a JSON claim carrying the
//  account id, proven address, and issued-at, so we can enforce a 90-day
//  ROLLING expiry (each valid read reissues a fresh 90-day cookie).
//
//  The cookie is HttpOnly, so client components can't read it directly — they
//  ask GET /api/me instead.
//
//  SCOPE: the claim also records HOW the session was proven —
//    'challenge' = the nonce-in-OP_RETURN login flow (lib/walletAuth). A fresh,
//                  single-use, server-issued nonce makes it unspoofable.
//    'pay'       = minted as a side effect of pay-to-unlock (verify-payment).
//                  Only spend authority is proven, and the unlock txid is public
//                  in the mempool, so this scope is weaker (a race is possible).
//  Payout / author-mutation routes must require getChallengeSession() so a
//  'pay' session can never touch funds. Sessions issued before this field
//  existed have via === undefined and are treated as NOT challenge-verified.
//
//  Env: COOKIE_SECRET (reused — same secret the unlock cookies use).
// =============================================================================

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "pow_session";
export const SESSION_MAX_AGE_DAYS = 90;
const MAX_AGE_MS = SESSION_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

export type SessionVia = "pay" | "challenge";

export type SessionClaim = {
  accountId: string;
  address: string;      // the proven primary address at issue time
  iat: number;          // issued-at (epoch ms)
  via?: SessionVia;     // how control was proven (absent on legacy cookies)
};

function getSecret(): string {
  const secret = process.env.COOKIE_SECRET;
  if (!secret || typeof secret !== "string" || !secret.trim()) {
    throw new Error("COOKIE_SECRET is not set");
  }
  return secret.trim();
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/** Sign a claim -> "{base64url(json)}.{hexsig}". HMAC-SHA256 over the encoded payload. */
export function signSession(claim: SessionClaim): string {
  const secret = getSecret();
  const encoded = b64url(JSON.stringify(claim));
  const sig = createHmac("sha256", secret).update(encoded).digest("hex");
  return `${encoded}.${sig}`;
}

/** Verify signature + expiry. Returns the claim, or null if bad/expired. */
export function verifySession(cookieValue: string | undefined | null): SessionClaim | null {
  if (!cookieValue || typeof cookieValue !== "string") return null;
  let secret: string;
  try { secret = getSecret(); } catch { return null; }

  const trimmed = cookieValue.trim();
  const dot = trimmed.indexOf(".");
  if (dot <= 0 || dot === trimmed.length - 1) return null;

  const encoded = trimmed.slice(0, dot);
  const sigHex = trimmed.slice(dot + 1);
  if (!/^[0-9a-f]+$/i.test(sigHex)) return null;

  const expectedHex = createHmac("sha256", secret).update(encoded).digest("hex");
  if (sigHex.length !== expectedHex.length) return null;

  let ok = false;
  try {
    const a = Buffer.from(sigHex, "hex");
    const b = Buffer.from(expectedHex, "hex");
    if (a.length !== b.length) return null;
    ok = timingSafeEqual(a, b);
  } catch { return null; }
  if (!ok) return null;

  let claim: SessionClaim;
  try { claim = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));}
  catch { return null; }

  if (!claim || typeof claim.accountId !== "string" || typeof claim.iat !== "number") return null;
  if (Date.now() - claim.iat > MAX_AGE_MS) return null; // expired

  return claim;
}

// ---------------------------------------------------------------------------
//  server helpers (route handlers / server components) via next/headers
// ---------------------------------------------------------------------------

/** Issue a fresh session cookie for an authenticated account.
 *  `via` records how control was proven; omit it only for flows that should be
 *  treated as non-challenge (weaker) scope. */
export async function setSessionCookie(
  accountId: string,
  address: string,
  via?: SessionVia,
): Promise<void> {
  const claim: SessionClaim = { accountId, address, iat: Date.now() };
  if (via) claim.via = via;
  const value = signSession(claim);
  const store = await cookies();
  store.set(SESSION_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(MAX_AGE_MS / 1000),
  });
}

/** Read + verify the current session. Rolling: if valid, reissue with a fresh
 *  90-day clock so active users are effectively never logged out. The `via`
 *  scope is preserved across refreshes. Returns the claim or null. Safe to call
 *  in any server context that can set cookies. */
export async function getSession(): Promise<SessionClaim | null> {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  const claim = verifySession(raw);
  if (!claim) return null;

  // rolling refresh — reissue with a new iat on each valid read (via preserved)
  try {
    const refreshed = signSession({ ...claim, iat: Date.now() });
    store.set(SESSION_COOKIE, refreshed, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: Math.floor(MAX_AGE_MS / 1000),
    });
  } catch { /* if the store is read-only here, just return the claim */ }

  return claim;
}

/** Like getSession(), but returns the claim ONLY if it was proven via the
 *  nonce-based challenge flow. Use this to gate author / payout mutations so a
 *  pay-minted (race-spoofable) session can never move funds. Returns null for
 *  pay-scope sessions, legacy (via-less) sessions, and no session. */
export async function getChallengeSession(): Promise<SessionClaim | null> {
  const claim = await getSession();
  if (!claim) return null;
  return claim.via === "challenge" ? claim : null;
}

/** Clear the session (logout). */
export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
