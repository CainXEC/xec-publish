import type { SupabaseClient } from "@supabase/supabase-js";

// =============================================================================
//  lib/accountAuthorLink.ts — the single sanctioned hop across the two identity
//  worlds.
//
//  The article/legacy world keys on authors.id (posts.author_id, publishes);
//  the feed/social world keys on accounts.id. accounts.author_id bridges them,
//  and the relationship is 1:1 — enforced by a unique index on
//  accounts.author_id (sql/accounts_author_unique.sql). Before that index the
//  hop was reimplemented inline with `.eq('author_id', X).maybeSingle()` in
//  several places, each independently assuming (but not guaranteeing) 1:1.
//
//  Use this instead of a fresh inline lookup. Returns null when the author has
//  no account (a legacy/transient state — every new wallet now gets both).
// =============================================================================

export async function accountIdForAuthorId(
  supabase: SupabaseClient,
  authorId: string | null | undefined,
): Promise<string | null> {
  if (!authorId) return null;
  const { data } = await supabase
    .from("accounts")
    .select("id")
    .eq("author_id", authorId)
    .maybeSingle();
  return data?.id ?? null;
}

/**
 * An article author's CURRENT payout address for building/verifying a payment
 * (article-comment splits). Resolves the account's LIVE primary
 * (account_addresses.is_primary) first, falling back to the legacy
 * authors.xec_address only for account-less legacy authors.
 *
 * WHY primary-first: the payout wallet is denormalized in three places
 * (account_addresses.is_primary, authors.xec_address, feed_posts.payout_address)
 * that change_primary_address keeps in sync. Reading the primary directly means
 * "where to pay" no longer depends on that sync holding for THIS read — it treats
 * account_addresses as the single source of truth, per the earnings-follow-the-
 * account invariant. In the normal case primary === xec_address, so this is
 * behavior-neutral; it only differs if they've diverged, where the live primary
 * is the correct payee. Returns null if the author has no payable address.
 *
 * NOTE: intentionally does NOT touch the payout SNAPSHOTS already frozen on
 * unlocks / feed_posts / comments rows at write time — those are historical record.
 */
export async function payoutAddressForAuthorId(
  supabase: SupabaseClient,
  authorId: string | null | undefined,
): Promise<string | null> {
  if (!authorId) return null;
  const accountId = await accountIdForAuthorId(supabase, authorId);
  if (accountId) {
    const { data: primary } = await supabase
      .from("account_addresses")
      .select("address")
      .eq("account_id", accountId)
      .eq("is_primary", true)
      .maybeSingle();
    if (primary?.address) return primary.address;
  }
  const { data: author } = await supabase
    .from("authors")
    .select("xec_address")
    .eq("id", authorId)
    .maybeSingle();
  return author?.xec_address ?? null;
}
