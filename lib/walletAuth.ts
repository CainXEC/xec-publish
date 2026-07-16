// =============================================================================
//  lib/walletAuth.ts
//  Unified wallet login (readers + authors). Two independent guarantees:
//
//    1. SPEND AUTHORITY — the login payment's INPUT address is read as the
//       identity. Only the key-holder can spend from an address, so this proves
//       control. (Same payerOf() logic the claim flow uses.)
//    2. NONCE IN OP_RETURN — the payment must carry a server-issued one-time
//       nonce (a UUID, in op_return_raw). This ties the payment to THIS login
//       challenge, killing replay of old on-chain payments and coincidental
//       same-amount sends. No reliance on timing.
//
//  Because of (2) this flow is unspoofable, so sessions it mints are stamped
//  via: 'challenge' — the scope payout/author-mutation routes require.
//
//  Flow:
//    startAuth()  -> sweep expired nonces, issue a fresh nonce (5-min expiry),
//                    return a 5.5 XEC payment request with the nonce in OP_RETURN.
//    verifyAuth() -> find a payment to the auth address carrying a LIVE nonce,
//                    read its sender, resolve-or-create the account, delete the
//                    nonce, issue the session cookie.
//
//  A second flow reuses the same challenge machinery to CHANGE an account's
//  address: startAddressChange() / verifyAddressChange() — see the section at
//  the bottom of this file and sql/change_primary_address.sql.
//
//  Env: AUTH_PROOF_ADDRESS (falls back to MINT_PAYMENT_ADDRESS), COOKIE_SECRET.
// =============================================================================

import { createClient } from "@supabase/supabase-js";
import { ChronikClient } from "chronik-client";
import { encodeCashAddress } from "ecashaddrjs";
import { randomUUID } from "node:crypto";
import { decodeOpReturnToPostId } from "@/lib/opReturnEncode";
import { encodeFeedOpReturnRaw, decodeFeedOpReturn, FEED_ACTION } from "@/lib/feedProtocol";
import { setSessionCookie, type SessionClaim } from "@/lib/session";
import { signCookieValue, verifyCookieValue } from "@/lib/cookieSigner";
import { cookies } from "next/headers";
import { heldHandlesForAddress } from "@/lib/heldHandles";
import { currentTokenHolder } from "@/lib/resolveProfile";
import { CHRONIK_URLS } from "@/lib/ecash/chronikEndpoints";

let _chronik: ChronikClient | null = null;
const chronik = () => (_chronik ??= new ChronikClient(CHRONIK_URLS));

const supabase = createClient(
  (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL)!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const AUTH_ADDRESS = process.env.AUTH_PROOF_ADDRESS ?? process.env.MINT_PAYMENT_ADDRESS!;
// Signed, HttpOnly cookie that binds a login challenge to the browser that
// STARTED it. verifyAuth() will only accept the nonce carried in this cookie, so
// an attacker who reads the (public, on-chain) nonce from the victim's payment
// can no longer race the victim's status poll and be handed the victim's session.
const AUTH_NONCE_COOKIE = "pow_auth_nonce";
// Same construction, separate cookie, for the CHANGE-ADDRESS challenge. Distinct
// names mean the login poller can never claim an address-change nonce (each
// verifier only accepts the nonce carried in its own cookie) even though both
// flows share the auth_challenges table and the on-chain payment shape.
const ADDR_NONCE_COOKIE = "pow_addr_nonce";
const PROOF_XEC = "5.50";               // fixed login amount, below the 6.00 claim floor
const PROOF_SATS_MIN = 550;             // 5.50 XEC = 550 sats; accept >= this
const NONCE_TTL_MINUTES = 5;
const FRESH_SECONDS = 15 * 60;          // ignore txs older than this as a backstop

// ---- address decode (matches mintPayments conventions) ---------------------
function scriptToAddress(outputScriptHex: string): string | null {
  const s = String(outputScriptHex).toLowerCase();
  if (s.startsWith("76a914") && s.endsWith("88ac") && s.length === 50) {
    return encodeCashAddress("ecash", "p2pkh", s.slice(6, 46));
  }
  if (s.startsWith("a914") && s.endsWith("87") && s.length === 46) {
    return encodeCashAddress("ecash", "p2sh", s.slice(4, 44));
  }
  return null;
}
function satsToAddress(tx: any, toAddress: string): number {
  let total = 0;
  for (const out of tx.outputs ?? []) {
    if (scriptToAddress(out.outputScript) === toAddress) total += Number(out.sats ?? out.value ?? 0);
  }
  return total;
}
function payerOf(tx: any): string | null {
  const first = (tx.inputs ?? [])[0];
  return first ? scriptToAddress(first.outputScript) : null;
}

/** True when the address is a Pocket (browser-held spending key, kind='pocket').
 *  Pocket payments ATTRIBUTE to their account like any linked address, but the
 *  pocket key must never authenticate: login and address-change both refuse it,
 *  so a stolen pocket key is capped at spending the pocket change. */
async function isPocketAddress(address: string): Promise<boolean> {
  const bare = String(address ?? "").toLowerCase().replace(/^ecash:/, "");
  if (!bare) return false;
  const { data } = await supabase
    .from("account_addresses")
    .select("kind")
    .in("address", [bare, `ecash:${bare}`])
    .eq("kind", "pocket")
    .limit(1);
  return Boolean(data?.[0]);
}

/** The account's LIVE primary address (the DB row, never the session cookie),
 *  with a caller-chosen fallback for accounts that somehow lack one. Confirm
 *  routes use this to snapshot payouts/bylines: a payment signed by a linked
 *  non-primary wallet (e.g. the Pocket) must still route future earnings and
 *  display identity to the account's real payout wallet. */
export async function primaryAddressForAccount(accountId: string, fallback: string): Promise<string> {
  const { data } = await supabase
    .from("account_addresses")
    .select("address")
    .eq("account_id", accountId)
    .eq("is_primary", true)
    .maybeSingle();
  return data?.address ?? fallback;
}
// Read the login nonce from a tx's OP_RETURN. Accepts BOTH layouts so payments
// in flight across the deploy still verify: the new POWR auth envelope
// (LOKAD | v0 | OP_8 | nonce) and the legacy bare-UUID push (no LOKAD).
function nonceOf(tx: any): string | null {
  for (const out of tx.outputs ?? []) {
    const script = String(out.outputScript ?? "").toLowerCase();
    if (!script.startsWith("6a")) continue;
    const powr = decodeFeedOpReturn(script);
    if (powr && powr.action === FEED_ACTION.AUTH && powr.nonce) return powr.nonce;
    const legacy = decodeOpReturnToPostId(script);
    if (legacy) return legacy;
  }
  return null;
}

// ---------------------------------------------------------------------------
//  step 1: start a login — issue a nonce, return the payment request
// ---------------------------------------------------------------------------
export type StartAuthResult = {
  ok: true;
  proofAddress: string;
  amountXec: string;
  opReturnRaw: string;
  bip21Url: string;       // raw, un-encoded: ecash:ADDR?amount=X&op_return_raw=Y
  expiresAt: string;
};

async function issueNonceChallenge(cookieName: string, cookiePurpose: string): Promise<StartAuthResult> {
  // sweep expired nonces (self-cleaning; no cron needed)
  await supabase.from("auth_challenges").delete().lt("expires_at", new Date().toISOString());

  const nonce = randomUUID(); // 36-char UUID -> fits the OP_8 nonce push
  const expiresAt = new Date(Date.now() + NONCE_TTL_MINUTES * 60_000).toISOString();
  await supabase.from("auth_challenges").insert({ nonce, expires_at: expiresAt });

  // Bind this challenge to the calling browser. The verifier will only accept the
  // nonce carried in this signed, HttpOnly cookie — so only the browser that
  // started the flow can complete it, even though the nonce is public on-chain.
  const store = await cookies();
  store.set(cookieName, signCookieValue(cookiePurpose, nonce), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: NONCE_TTL_MINUTES * 60,
  });

  const opReturnRaw = encodeFeedOpReturnRaw({ action: FEED_ACTION.AUTH, nonce });
  const bip21Url = `${AUTH_ADDRESS}?amount=${PROOF_XEC}&op_return_raw=${opReturnRaw}`;

  return { ok: true, proofAddress: AUTH_ADDRESS, amountXec: PROOF_XEC, opReturnRaw, bip21Url, expiresAt };
}

export async function startAuth(): Promise<StartAuthResult> {
  return issueNonceChallenge(AUTH_NONCE_COOKIE, "auth_nonce");
}

// ---------------------------------------------------------------------------
//  step 2: verify — find a payment carrying a live nonce, log in its sender
// ---------------------------------------------------------------------------
export type VerifyAuthResult =
  | { ok: true; accountId: string; address: string; authorId: string | null; handle: string | null }
  | { ok: false; status: "awaiting_payment" | "expired" | "pocket_address" | "error"; error?: string };

export async function verifyAuth(): Promise<VerifyAuthResult> {
  try {
    // The login is bound to the browser that started it: only the nonce carried
    // in this signed, HttpOnly cookie can complete here. Without it there is
    // nothing to verify — an attacker polling with no/forged cookie matches
    // nothing — which is what closes the front-running window.
    const store = await cookies();
    const { valid, txid: boundNonce } = verifyCookieValue(
      "auth_nonce",
      store.get(AUTH_NONCE_COOKIE)?.value,
    );
    if (!valid || !boundNonce) {
      return { ok: false, status: "awaiting_payment" };
    }

    const page = await chronik().address(AUTH_ADDRESS).history(0, 25);
    const nowSec = Math.floor(Date.now() / 1000);

    // A pocket-paid challenge shouldn't kill the login: remember the reason,
    // keep the nonce alive, and let the user simply pay again from their main
    // wallet with the SAME request (mirrors verifyAddressChange's hints).
    let pocketHint = false;

    for (const tx of page.txs ?? []) {
      const seen = Number(tx.timeFirstSeen ?? 0);
      if (seen && nowSec - seen > FRESH_SECONDS) continue;     // backstop freshness
      if (satsToAddress(tx, AUTH_ADDRESS) < PROOF_SATS_MIN) continue;

      const nonce = nonceOf(tx);
      if (!nonce || nonce !== boundNonce) continue;   // only THIS browser's challenge

      const address = payerOf(tx);
      if (!address) continue;

      // A Pocket key can spend pocket change; it can NOT authenticate. Without
      // this, exfiltrating a browser-held pocket key would mint a full
      // challenge-scope session for the account it's linked to.
      if (await isPocketAddress(address)) {
        pocketHint = true;
        continue;
      }

      // Atomically claim the nonce with a conditional DELETE ... RETURNING. The
      // client polls this endpoint, so two in-flight verifies could otherwise
      // both pass a non-atomic read-then-delete and mint two sessions. Folding
      // the liveness check into the delete predicate (expires_at >= now) means an
      // expired nonce claims nothing; a returned row proves we won the single-use
      // race for a still-live challenge.
      const { data: claimed } = await supabase
        .from("auth_challenges")
        .delete()
        .eq("nonce", nonce)
        .gte("expires_at", new Date().toISOString())
        .select("nonce")
        .maybeSingle();
      if (!claimed) continue; // already used, expired, or lost the race

      // resolve-or-create the account for this proven address, then issue the
      // session (nonce-proven = challenge scope).
      const resolved = await resolveOrCreateAccount(address);
      await setSessionCookie(resolved.accountId, address, "challenge");
      // single-use: drop the binding cookie so this challenge can't be replayed.
      store.set(AUTH_NONCE_COOKIE, "", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 0,
      });

      return { ok: true, accountId: resolved.accountId, address, authorId: resolved.authorId, handle: resolved.handle };
    }

    if (pocketHint) {
      return {
        ok: false,
        status: "pocket_address",
        error:
          "That payment came from your Pocket (spending balance). Log in by paying from your main Cashtab wallet instead.",
      };
    }
    return { ok: false, status: "awaiting_payment" };
  } catch (e: any) {
    return { ok: false, status: "error", error: e?.message ?? "auth verification failed" };
  }
}

// ---------------------------------------------------------------------------
//  resolve-or-create: proven address -> account
//    1. existing account_addresses link -> that account
//    2. legacy author (authors.xec_address, prefixed or bare) -> create+link account
//    3. brand-new address -> fresh plain account
//
//  Exported so the pay-to-unlock login (verify-payment) mints IDENTICAL
//  accounts through the same path — never a forked duplicate.
// ---------------------------------------------------------------------------
export async function resolveOrCreateAccount(address: string): Promise<{ accountId: string; authorId: string | null; handle: string | null }> {
  const now = new Date().toISOString();
  const forms = [address, `ecash:${address}`];

  // 1) existing link
  const { data: links } = await supabase
    .from("account_addresses").select("account_id").in("address", forms).limit(1);
  if (links?.[0]?.account_id) {
    const { data: acct } = await supabase
      .from("accounts")
      .select("id, author_id, display_handle, active_handle_token_id")
      .eq("id", links[0].account_id).maybeSingle();
    if (acct) {
      const handle = await bindDefaultHandle(acct.id, address, acct.active_handle_token_id ?? null, acct.display_handle ?? null);
      return { accountId: acct.id, authorId: acct.author_id ?? null, handle };
    }
  }

  // 2) Every account is an author identity — there is no reader/author split.
  //    Reuse a legacy author row if one already exists for this address; otherwise
  //    mint a fresh one so a brand-new wallet is write-capable from day one, with
  //    payout to the proven login address. (If author creation fails — e.g. the
  //    unify_reader_author migration hasn't relaxed the legacy email/username
  //    NOT NULLs yet — we fall back to author_id = null, i.e. today's behavior,
  //    so login never breaks; the backfill migration then heals it.)
  const { data: authors } = await supabase
    .from("authors").select("id").in("xec_address", forms).limit(1);
  let authorId = authors?.[0]?.id ?? null;
  if (!authorId) {
    const { data: newAuthor } = await supabase
      .from("authors")
      .insert({ xec_address: address, is_admin: false })
      .select("id")
      .single();
    authorId = newAuthor?.id ?? null;
  }

  // create the account linked to its author
  const { data: acct } = await supabase
    .from("accounts")
    .insert({ author_id: authorId, updated_at: now })
    .select("id, author_id, display_handle")
    .single();
  const accountId = acct!.id as string;

  // link the proven address as primary
  await supabase.from("account_addresses").insert({ account_id: accountId, address, is_primary: true, verified_at: now });

  // a brand-new account holds no bound handle yet — bind one if the wallet has any
  const handle = await bindDefaultHandle(accountId, address, null, acct?.display_handle ?? null);
  return { accountId, authorId, handle };
}

// ---------------------------------------------------------------------------
//  auto-bind a display handle at login
//  On-chain holdings are the source of truth. If the wallet holds any of our
//  handles and the account has no valid bound handle, bind the newest one as a
//  sensible default (the user can change it later). If the account's current
//  bound handle is still held, keep it — never override the user's choice.
//
//  BEST-EFFORT: an empty held-list may mean "Chronik is down", so we NEVER
//  clear an existing binding here; reconciliation of a moved-away handle is
//  handled lazily on read (resolveProfile.freshDisplayHandle).
// ---------------------------------------------------------------------------
async function bindDefaultHandle(
  accountId: string,
  address: string,
  currentTokenId: string | null,
  currentHandle: string | null,
): Promise<string | null> {
  const held = await heldHandlesForAddress(address);
  if (held.length === 0) return currentHandle; // can't confirm holdings; leave as-is

  // Keep the existing choice if it's still on-chain in this wallet.
  if (currentTokenId && held.some((h) => h.tokenId === currentTokenId)) {
    return currentHandle;
  }

  // Otherwise default to the newest held handle (heldHandlesForAddress is
  // ordered newest-first).
  const pick = held[0];
  await supabase
    .from("accounts")
    .update({
      active_handle_token_id: pick.tokenId,
      display_handle: pick.handle,
      display_handle_checked_at: new Date().toISOString(),
    })
    .eq("id", accountId);
  return pick.handle;
}

// ---------------------------------------------------------------------------
//  CHANGE ADDRESS — same challenge construction as login, opposite direction.
//  Login proves "this wallet may act as this account"; the change flow proves
//  "this account's owner also controls a NEW wallet" and then re-points the
//  account at it. Two independent proofs are required before anything moves:
//    1. a challenge-scope session for the account (the caller/route enforces
//       getChallengeSession() — a weaker pay-minted session can never redirect
//       earnings), and
//    2. a nonce payment signed by the NEW wallet (spend authority, exactly like
//       login — typing an address into a form proves nothing).
//  The swap itself is one transaction (sql/change_primary_address.sql): demote
//  the old primary but KEEP it linked (unlock entitlements + the old wallet can
//  still log in, so a hijacked account's real owner can always switch back),
//  promote/insert the new address, and re-point authors.xec_address +
//  feed_posts.payout_address so earnings follow the account.
// ---------------------------------------------------------------------------

export async function startAddressChange(): Promise<StartAuthResult> {
  return issueNonceChallenge(ADDR_NONCE_COOKIE, "addr_nonce");
}

export type VerifyAddressChangeResult =
  | {
      ok: true;
      newAddress: string;
      oldAddress: string | null;
      /** the display handle still bound after the swap, or null */
      handle: string | null;
      /** false when a bound handle was unbound because its NFT stayed in the old wallet */
      handleKept: boolean;
      /** true when the new wallet's unused shell account was folded into this one */
      absorbed: boolean;
    }
  | { ok: false; status: "awaiting_payment" | "same_address" | "address_in_use" | "pocket_address" | "error"; error?: string };

export async function verifyAddressChange(claim: SessionClaim): Promise<VerifyAddressChangeResult> {
  try {
    const store = await cookies();
    const { valid, txid: boundNonce } = verifyCookieValue(
      "addr_nonce",
      store.get(ADDR_NONCE_COOKIE)?.value,
    );
    if (!valid || !boundNonce) {
      return { ok: false, status: "awaiting_payment" };
    }

    // The address being replaced: the account's live primary (the session's
    // address can be stale if this account already swapped once on another
    // device — the DB row is the source of truth).
    const { data: primaryRow } = await supabase
      .from("account_addresses")
      .select("address")
      .eq("account_id", claim.accountId)
      .eq("is_primary", true)
      .maybeSingle();
    const oldAddress = primaryRow?.address ?? claim.address ?? null;
    const oldBare = String(oldAddress ?? "").toLowerCase().replace(/^ecash:/, "");

    const page = await chronik().address(AUTH_ADDRESS).history(0, 25);
    const nowSec = Math.floor(Date.now() / 1000);

    // A wrong-wallet payment shouldn't kill the challenge: remember the reason,
    // keep scanning (and keep the nonce alive), so the user can simply pay again
    // from the right wallet with the SAME request while the countdown runs.
    let hint: "same_address" | "address_in_use" | "pocket_address" | null = null;
    let hintError = "";

    for (const tx of page.txs ?? []) {
      const seen = Number(tx.timeFirstSeen ?? 0);
      if (seen && nowSec - seen > FRESH_SECONDS) continue;
      if (satsToAddress(tx, AUTH_ADDRESS) < PROOF_SATS_MIN) continue;

      const nonce = nonceOf(tx);
      if (!nonce || nonce !== boundNonce) continue;

      const candidate = payerOf(tx);
      if (!candidate) continue;
      const candidateBare = candidate.toLowerCase().replace(/^ecash:/, "");

      if (candidateBare === oldBare) {
        hint = "same_address";
        hintError = "That payment came from your CURRENT wallet. Send it from the new wallet you want to switch to.";
        continue;
      }

      // A Pocket (browser-held spending key) can never become a primary — the
      // RPC re-checks transactionally (v3 'pocket_address'); this early check
      // just keeps the challenge alive with a friendlier message.
      if (await isPocketAddress(candidate)) {
        hint = "pocket_address";
        hintError = "That wallet is a Pocket (spending balance) — it can't become your main address. Pay from the real wallet you want to switch to.";
        continue;
      }

      // Owned by another account? An EMPTY shell (minted by a stray login with
      // the new wallet — no posts, no paid reactions, no follows) is absorbed
      // by the RPC, so only accounts with real activity block. Checked before
      // claiming the nonce so a hard conflict leaves the challenge alive (the
      // RPC re-checks transactionally — this early check is only for a
      // friendlier retry).
      const candidateForms = [candidateBare, `ecash:${candidateBare}`];
      const { data: taken } = await supabase
        .from("account_addresses")
        .select("account_id")
        .in("address", candidateForms)
        .neq("account_id", claim.accountId)
        .limit(1);
      if (taken?.[0] && !(await isAbsorbableShell(taken[0].account_id))) {
        hint = "address_in_use";
        hintError = "That wallet already has an account with activity on it. Log into that account and delete it if you want to reuse the wallet — or pay from a different wallet.";
        continue;
      }

      // Single-use claim — same atomic conditional DELETE as login.
      const { data: claimed } = await supabase
        .from("auth_challenges")
        .delete()
        .eq("nonce", nonce)
        .gte("expires_at", new Date().toISOString())
        .select("nonce")
        .maybeSingle();
      if (!claimed) continue;

      // Atomic three-way swap (account_addresses / authors.xec_address /
      // feed_posts.payout_address), absorbing an empty shell account when the
      // new wallet has one — see sql/change_primary_address.sql.
      const { data: swapResult, error: rpcError } = await supabase.rpc("change_primary_address", {
        p_account_id: claim.accountId,
        p_new_address: candidate,
      });
      if (rpcError) {
        const msg = String(rpcError.message ?? "");
        const inUse = msg.includes("address_in_use");
        const isPocket = msg.includes("pocket_address");
        return {
          ok: false,
          status: isPocket ? "pocket_address" : inUse ? "address_in_use" : "error",
          error: isPocket
            ? "That wallet is a Pocket (spending balance) — it can't become your main address."
            : inUse
              ? "That wallet already has an account with activity on it. Log into that account and delete it if you want to reuse the wallet."
              : rpcError.message ?? "Could not change the address.",
        };
      }
      const absorbed = (swapResult as any)?.absorbed === true;

      // If a display handle is bound, it survives only if its NFT already sits
      // in the NEW wallet. Unverifiable (Chronik down) keeps the binding — the
      // lazy profile-read check reconciles later, same as freshDisplayHandle.
      const { handle, kept } = await rebindHandleAfterSwap(claim.accountId, candidate);

      // Re-stamp the session for the new address (still challenge scope: the
      // account was proven by the gating session, the wallet by this payment).
      await setSessionCookie(claim.accountId, candidate, "challenge");
      store.set(ADDR_NONCE_COOKIE, "", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 0,
      });

      return { ok: true, newAddress: candidate, oldAddress, handle, handleKept: kept, absorbed };
    }

    if (hint) return { ok: false, status: hint, error: hintError };
    return { ok: false, status: "awaiting_payment" };
  } catch (e: any) {
    return { ok: false, status: "error", error: e?.message ?? "address change verification failed" };
  }
}

/** True when the account currently owning the candidate wallet is an empty
 *  shell the swap RPC will absorb: no articles, no feed posts, no paid
 *  reactions, no follows in either direction. Advisory only — the RPC re-checks
 *  the same conditions inside the transaction; this pre-check just keeps the
 *  challenge alive (recoverable hint) when the account has real activity. */
async function isAbsorbableShell(accountId: string): Promise<boolean> {
  const { data: acct } = await supabase
    .from("accounts")
    .select("author_id")
    .eq("id", accountId)
    .maybeSingle();
  if (!acct) return true; // vanished already — nothing to block on

  const [feedPosts, feedEvents, followsOut, followsIn, posts] = await Promise.all([
    supabase.from("feed_posts").select("id", { count: "exact", head: true }).eq("author_account_id", accountId),
    supabase.from("feed_events").select("actor_account_id", { count: "exact", head: true }).eq("actor_account_id", accountId),
    supabase.from("feed_follows").select("follower_account_id", { count: "exact", head: true }).eq("follower_account_id", accountId),
    supabase.from("feed_follows").select("followee_account_id", { count: "exact", head: true }).eq("followee_account_id", accountId),
    acct.author_id
      ? supabase.from("posts").select("id", { count: "exact", head: true }).eq("author_id", acct.author_id)
      : Promise.resolve({ count: 0 } as { count: number | null }),
  ]);
  return !(
    (feedPosts.count ?? 0) ||
    (feedEvents.count ?? 0) ||
    (followsOut.count ?? 0) ||
    (followsIn.count ?? 0) ||
    (posts.count ?? 0)
  );
}

/** After a swap: keep the bound display handle only if its NFT is already in
 *  the new wallet; clear it if the NFT verifiably stayed behind. Mirrors
 *  freshDisplayHandle's cache philosophy — can't verify -> don't churn. */
async function rebindHandleAfterSwap(
  accountId: string,
  newAddress: string,
): Promise<{ handle: string | null; kept: boolean }> {
  const { data: acct } = await supabase
    .from("accounts")
    .select("active_handle_token_id, display_handle")
    .eq("id", accountId)
    .maybeSingle();
  const tokenId = acct?.active_handle_token_id ?? null;
  if (!tokenId) return { handle: null, kept: true }; // nothing bound, nothing to lose

  const holder = await currentTokenHolder(tokenId);
  if (!holder) return { handle: acct?.display_handle ?? null, kept: true };

  const now = new Date().toISOString();
  if (holder === newAddress) {
    await supabase
      .from("accounts")
      .update({ display_handle_checked_at: now })
      .eq("id", accountId);
    return { handle: acct?.display_handle ?? null, kept: true };
  }

  await supabase
    .from("accounts")
    .update({ active_handle_token_id: null, display_handle: null, display_handle_checked_at: now })
    .eq("id", accountId);
  return { handle: null, kept: false };
}
