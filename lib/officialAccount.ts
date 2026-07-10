// =============================================================================
//  officialAccount.ts
//  Resolves the account that authors handle-mint feed cards — the @proofofwriting
//  identity. It is simply the MINT WALLET's own account: the mint wallet holds the
//  @proofofwriting handle NFT, so /@proofofwriting resolves to it (on-chain holder
//  == card author == one coherent profile), and its address is where mint-card
//  reactions (tips) pay. Anchored to the mint wallet's address (MINT_PAYMENT_ADDRESS).
//
//  Set-up is "just another account": mint @proofofwriting to the mint wallet, then
//  either log in as that wallet (auto-binds display_handle='proofofwriting') or run
//  scripts/ensure-official-account.ts. Resolved lazily and cached per instance.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

export interface OfficialAccount {
  accountId: string;
  address: string; // the mint wallet address (holds @proofofwriting; tip payout target)
}

let _cache: OfficialAccount | null = null;

/** The mint wallet's receiving address (the @proofofwriting holder), or null if unset. */
export function officialAddress(): string | null {
  return process.env.MINT_PAYMENT_ADDRESS?.trim() || null;
}

/** address forms the DB may store it in (with / without the ecash: prefix). */
export function addressForms(addr: string): string[] {
  return addr.startsWith("ecash:") ? [addr, addr.slice(6)] : [addr, `ecash:${addr}`];
}

/**
 * Resolve the official account id by the platform address link. Returns null
 * (and does NOT cache the miss) if the account hasn't been created yet, so a
 * later call after setup still finds it within a warm instance.
 */
export async function resolveOfficialAccount(supabase: SupabaseClient): Promise<OfficialAccount | null> {
  if (_cache) return _cache;
  const addr = officialAddress();
  if (!addr) return null;
  const { data } = await supabase
    .from("account_addresses")
    .select("account_id")
    .in("address", addressForms(addr))
    .limit(1);
  const accountId = data?.[0]?.account_id as string | undefined;
  if (!accountId) return null;
  _cache = { accountId, address: addr };
  return _cache;
}
