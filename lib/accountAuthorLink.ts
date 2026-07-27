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
