import type { NextRequest, NextResponse } from "next/server";
import {
  verifySession,
  signSession,
  SESSION_COOKIE,
  SESSION_MAX_AGE_DAYS,
} from "@/lib/session";

// =============================================================================
//  lib/paySession.ts — "pay doubles as login", in one place.
//
//  After a successful paid action (feed post/reply/quote, article comment, or
//  like/repost) the payer gets a 'pay'-scope session minted onto the response —
//  UNLESS the request already carries a stronger 'challenge' session for the same
//  account (never downgrade). The feed, comment, and reaction confirm routes had
//  byte-identical copies of this block; this is the single definition.
//
//  Best-effort: any failure is logged and swallowed. The action is already
//  recorded on-chain and in the DB, so a session-mint hiccup must never fail the
//  response.
//
//  SECURITY — the CALLER decides whether to mint. feed/react/confirm only calls
//  this when the client proved its OWN txid (`providedTxid`): on the address-scan
//  path the matched tx can be a stranger's reaction, and minting from it would
//  hand the caller someone else's session. This helper assumes that decision was
//  already made upstream; it does not re-check.
// =============================================================================

export function mintPaySession(
  request: NextRequest,
  response: NextResponse,
  accountId: string,
  address: string,
  logTag: string,
): void {
  try {
    const existing = verifySession(request.cookies.get(SESSION_COOKIE)?.value);
    const keepStronger =
      existing && existing.via === "challenge" && existing.accountId === accountId;
    if (!keepStronger) {
      response.cookies.set({
        name: SESSION_COOKIE,
        value: signSession({ accountId, address, iat: Date.now(), via: "pay" }),
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: SESSION_MAX_AGE_DAYS * 24 * 60 * 60,
      });
    }
  } catch (e) {
    console.error(`[${logTag}] session mint failed (action still ok)`, e);
  }
}
