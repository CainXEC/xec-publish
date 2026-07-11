// =============================================================================
//  lib/handleOffers.ts — server helpers for the handle offer system.
//
//  Holdership is on-chain: the "holder" of a handle NFT is whoever's wallet
//  holds its single UTXO right now, so offers follow the token when it changes
//  hands. Resolution mirrors resolveProfile.ts: Chronik first (authoritative),
//  the accounts.active_handle_token_id binding as best-effort fallback when
//  Chronik is unreachable.
//
//  Used by app/api/handles/offer (place/withdraw) and /offers (read).
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { currentTokenHolder } from "@/lib/resolveProfile";

const bare = (address: string) => address.replace(/^ecash:/, "").toLowerCase();
const addressForms = (address: string) => {
  const b = bare(address);
  return [b, `ecash:${b}`];
};

export const shortAddress = (address: string) => {
  const b = bare(address);
  return `${b.slice(0, 8)}…${b.slice(-4)}`;
};

/** The account that currently holds this token, or null when the holder's
 *  wallet has no proofofwriting account (a mint that never logged in). */
export async function holderAccountIdForToken(
  supabase: SupabaseClient,
  tokenId: string
): Promise<string | null> {
  const holder = await currentTokenHolder(tokenId); // "ecash:q…" | null (Chronik down)

  if (holder) {
    const { data: links } = await supabase
      .from("account_addresses")
      .select("account_id")
      .in("address", addressForms(holder))
      .limit(1);
    return (links?.[0]?.account_id as string | undefined) ?? null;
  }

  // Chronik unreachable — fall back to the account currently bound to the
  // token (same staleness the profile page accepts during an outage).
  const { data: boundAccount } = await supabase
    .from("accounts")
    .select("id")
    .eq("active_handle_token_id", tokenId)
    .maybeSingle();
  return (boundAccount?.id as string | undefined) ?? null;
}

/** Display bylines for a set of accounts: "@handle" when one is displayed,
 *  else the account's primary address, shortened. Keyed by account id. */
export async function bidderDisplayMap(
  supabase: SupabaseClient,
  accountIds: string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (accountIds.length === 0) return out;

  const [{ data: accounts }, { data: addresses }] = await Promise.all([
    supabase.from("accounts").select("id, display_handle").in("id", accountIds),
    supabase
      .from("account_addresses")
      .select("account_id, address")
      .in("account_id", accountIds)
      .eq("is_primary", true),
  ]);

  const primaryByAccount = new Map(
    (addresses ?? []).map((a: { account_id: string; address: string }) => [
      a.account_id,
      a.address,
    ])
  );
  for (const a of (accounts ?? []) as Array<{ id: string; display_handle: string | null }>) {
    const primary = primaryByAccount.get(a.id);
    out.set(a.id, a.display_handle ? `@${a.display_handle}` : primary ? shortAddress(primary) : "a collector");
  }
  return out;
}
