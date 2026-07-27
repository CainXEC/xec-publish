// =============================================================================
//  lib/authHelpers.ts
//  Server-side auth gate for the wallet-session world. Wraps getSession() and
//  resolves the account -> author link, so every dashboard page / API route
//  swaps its old `supabase.auth.getUser()` for one consistent call.
//
//  Two flavours:
//    getAuthedAccount()  -> { accountId, authorId, address, isAdmin,
//                             handle, identity } | null
//    requireAuthorId()   -> authorId (throws Unauthorized if missing)  — for the
//                           common case where a route needs "who is this author".
//
//  `identity` is the display byline (handle if held, else raw ecash address),
//  computed identically to GET /api/me so a comment byline and a profile byline
//  render the same string.
//
//  NOTE: in queries, use authorId where the old code used user.id (user.id WAS
//  the authors.id). accountId is only for account-level things.
// =============================================================================

import { adminDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { formatIdentity } from "@/lib/formatIdentity";

const supabase = adminDb();

export type AuthedAccount = {
  accountId: string;
  authorId: string | null;
  address: string;
  isAdmin: boolean;
  isAi: boolean; // AI-operated account (authors.is_ai, set manually like is_admin)
  handle: string | null;
  handleColor: string | null; // chosen byline color, or null for the theme default
  identity: string; // "@handle" if held, else the raw ecash address
};

/** Resolve the current session to its account + author link (+ admin flag +
 *  display identity), or null if not logged in / the account no longer exists.
 *  Admin + identity resolution mirror /api/me so the two agree. */
export async function getAuthedAccount(): Promise<AuthedAccount | null> {
  const claim = await getSession();
  if (!claim) return null;

  // One round-trip: the author's is_admin comes embedded via the
  // accounts.author_id -> authors FK, and the linked addresses via the
  // account_addresses FK, instead of extra sequential queries.
  const { data: account } = await supabase
    .from("accounts")
    .select("id, author_id, display_handle, handle_color, authors(is_admin, is_ai), account_addresses(address, is_primary)")
    .eq("id", claim.accountId)
    .maybeSingle();
  if (!account) return null;

  const authorRow = Array.isArray(account.authors) ? account.authors[0] : account.authors;
  const isAdmin = authorRow?.is_admin === true;
  const isAi = authorRow?.is_ai === true;

  const handle = account.display_handle ?? null;

  // The account's LIVE primary address, not the one baked into the cookie at
  // issue time. After a change-address swap the cookie can lag (a rolling
  // refresh that was in flight during the swap re-signs the old claim), and a
  // login from a still-linked old wallet carries that wallet's address — in
  // both cases the account's identity/payout wallet is the DB primary.
  const addrRows = Array.isArray(account.account_addresses) ? account.account_addresses : [];
  const primary = addrRows.find((r: any) => r?.is_primary === true)?.address ?? null;
  const address = primary ?? claim.address;

  return {
    accountId: account.id,
    authorId: account.author_id ?? null,
    address,
    isAdmin,
    isAi,
    handle,
    handleColor: account.handle_color ?? null,
    identity: formatIdentity(handle, address),
  };
}

/** For routes/pages that require an AUTHOR (has published / has an author row).
 *  Throws a tagged error the caller can turn into a 401/redirect. */
export class UnauthorizedError extends Error {
  constructor(msg = "Unauthorized") { super(msg); this.name = "UnauthorizedError"; }
}

/** Returns the authorId for the current session, or throws UnauthorizedError.
 *  Use in API routes: catch and return 401. */
export async function requireAuthorId(): Promise<string> {
  const acct = await getAuthedAccount();
  if (!acct || !acct.authorId) throw new UnauthorizedError();
  return acct.authorId;
}
