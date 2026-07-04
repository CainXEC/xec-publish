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

import { createClient } from "@supabase/supabase-js";
import { getSession } from "@/lib/session";

const supabase = createClient(
  (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL)!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

export type AuthedAccount = {
  accountId: string;
  authorId: string | null;
  address: string;
  isAdmin: boolean;
  handle: string | null;
  identity: string; // "@handle" if held, else the raw ecash address
};

/** Resolve the current session to its account + author link (+ admin flag +
 *  display identity), or null if not logged in / the account no longer exists.
 *  Admin + identity resolution mirror /api/me so the two agree. */
export async function getAuthedAccount(): Promise<AuthedAccount | null> {
  const claim = await getSession();
  if (!claim) return null;

  const { data: account } = await supabase
    .from("accounts")
    .select("id, author_id, display_handle")
    .eq("id", claim.accountId)
    .maybeSingle();
  if (!account) return null;

  let isAdmin = false;
  if (account.author_id) {
    const { data: authorRow } = await supabase
      .from("authors")
      .select("is_admin")
      .eq("id", account.author_id)
      .maybeSingle();
    isAdmin = authorRow?.is_admin === true;
  }

  const handle = account.display_handle ?? null;

  return {
    accountId: account.id,
    authorId: account.author_id ?? null,
    address: claim.address,
    isAdmin,
    handle,
    identity: handle ? `@${handle}` : claim.address,
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
