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
//  Env: AUTH_PROOF_ADDRESS (falls back to MINT_PAYMENT_ADDRESS), COOKIE_SECRET.
// =============================================================================

import { createClient } from "@supabase/supabase-js";
import { ChronikClient } from "chronik-client";
import { encodeCashAddress } from "ecashaddrjs";
import { randomUUID } from "node:crypto";
import { encodePostIdOpReturnRaw, decodeOpReturnToPostId } from "@/lib/opReturnEncode";
import { setSessionCookie } from "@/lib/session";

const CHRONIK_URLS = ["https://chronik.e.cash", "https://chronik-native.fabien.cash"];
let _chronik: ChronikClient | null = null;
const chronik = () => (_chronik ??= new ChronikClient(CHRONIK_URLS));

const supabase = createClient(
  (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL)!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const AUTH_ADDRESS = process.env.AUTH_PROOF_ADDRESS ?? process.env.MINT_PAYMENT_ADDRESS!;
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
function nonceOf(tx: any): string | null {
  for (const out of tx.outputs ?? []) {
    const script = String(out.outputScript ?? "").toLowerCase();
    if (script.startsWith("6a")) {
      const decoded = decodeOpReturnToPostId(script);
      if (decoded) return decoded;
    }
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

export async function startAuth(): Promise<StartAuthResult> {
  // sweep expired nonces (self-cleaning; no cron needed)
  await supabase.from("auth_challenges").delete().lt("expires_at", new Date().toISOString());

  const nonce = randomUUID(); // 36-char UUID -> fits encodePostIdOpReturnRaw
  const expiresAt = new Date(Date.now() + NONCE_TTL_MINUTES * 60_000).toISOString();
  await supabase.from("auth_challenges").insert({ nonce, expires_at: expiresAt });

  const opReturnRaw = encodePostIdOpReturnRaw(nonce);
  const bip21Url = `${AUTH_ADDRESS}?amount=${PROOF_XEC}&op_return_raw=${opReturnRaw}`;

  return { ok: true, proofAddress: AUTH_ADDRESS, amountXec: PROOF_XEC, opReturnRaw, bip21Url, expiresAt };
}

// ---------------------------------------------------------------------------
//  step 2: verify — find a payment carrying a live nonce, log in its sender
// ---------------------------------------------------------------------------
export type VerifyAuthResult =
  | { ok: true; accountId: string; address: string; authorId: string | null; handle: string | null }
  | { ok: false; status: "awaiting_payment" | "expired" | "error"; error?: string };

export async function verifyAuth(): Promise<VerifyAuthResult> {
  try {
    const page = await chronik().address(AUTH_ADDRESS).history(0, 25);
    const nowSec = Math.floor(Date.now() / 1000);

    for (const tx of page.txs ?? []) {
      const seen = Number(tx.timeFirstSeen ?? 0);
      if (seen && nowSec - seen > FRESH_SECONDS) continue;     // backstop freshness
      if (satsToAddress(tx, AUTH_ADDRESS) < PROOF_SATS_MIN) continue;

      const nonce = nonceOf(tx);
      if (!nonce) continue;

      // is this nonce live?
      const { data: challenge } = await supabase
        .from("auth_challenges").select("nonce, expires_at").eq("nonce", nonce).maybeSingle();
      if (!challenge) continue;
      if (Date.parse(challenge.expires_at) < Date.now()) {
        await supabase.from("auth_challenges").delete().eq("nonce", nonce);
        continue;
      }

      const address = payerOf(tx);
      if (!address) continue;

      // resolve-or-create the account for this proven address
      const resolved = await resolveOrCreateAccount(address);

      // burn the nonce (single use) and issue the session (nonce-proven = challenge scope)
      await supabase.from("auth_challenges").delete().eq("nonce", nonce);
      await setSessionCookie(resolved.accountId, address, "challenge");

      return { ok: true, accountId: resolved.accountId, address, authorId: resolved.authorId, handle: resolved.handle };
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
      .from("accounts").select("id, author_id, display_handle").eq("id", links[0].account_id).maybeSingle();
    if (acct) return { accountId: acct.id, authorId: acct.author_id ?? null, handle: acct.display_handle ?? null };
  }

  // 2) legacy author by xec_address
  const { data: authors } = await supabase
    .from("authors").select("id").in("xec_address", forms).limit(1);
  const authorId = authors?.[0]?.id ?? null;

  // create the account (linking the author if we found one)
  const insert: any = { kind: authorId ? "author" : "reader", updated_at: now };
  if (authorId) insert.author_id = authorId;
  const { data: acct } = await supabase.from("accounts").insert(insert).select("id, author_id, display_handle").single();
  const accountId = acct!.id as string;

  // link the proven address as primary
  await supabase.from("account_addresses").insert({ account_id: accountId, address, is_primary: true, verified_at: now });

  return { accountId, authorId, handle: acct?.display_handle ?? null };
}
