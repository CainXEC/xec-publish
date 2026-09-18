// =============================================================================
//  lib/powRewards/accounts.ts
//  Shared account resolution for the reward scorer, so every component keys on
//  the SAME "effective account" and applies the SAME exclusions:
//    • effective account = COALESCE(account_links.cluster_id, account_id) — an
//      alt-cluster collapses to one earner (anti-Sybil, "filter before tally").
//    • is_ai house accounts and the founder/excluded accounts never earn.
// =============================================================================

import { adminDb } from "@/lib/db";

const IN_CHUNK = 100; // keep .in() lists short enough to not overflow the request URL

/** Founder / excluded accounts (env, comma-separated UUIDs). */
export function excludedAccountIds(): Set<string> {
  return new Set(
    (process.env.POW_REWARD_EXCLUDED_ACCOUNTS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export interface AccountResolver {
  /** account id → effective (cluster) id. */
  eff: (accountId: string) => string;
  /** true if this account (or its cluster) must not earn (is_ai or excluded). */
  excluded: (accountId: string) => boolean;
}

/** Build a resolver over the given account ids (clusters + is_ai + env excludes).
 *  `includeIds` force-includes accounts that would otherwise be excluded (founder
 *  self-view only — never passed by the real board/payout). Empty = normal. */
export async function buildResolver(
  accountIds: string[],
  includeIds: Set<string> = new Set(),
): Promise<AccountResolver> {
  const db = adminDb();
  const ids = Array.from(new Set(accountIds));
  const cluster = new Map<string, string>();
  const ai = new Set<string>();

  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const chunk = ids.slice(i, i + IN_CHUNK);
    const [{ data: links }, { data: ais }] = await Promise.all([
      db.from("account_links").select("account_id, cluster_id").in("account_id", chunk),
      db.from("accounts").select("id, authors!inner(is_ai)").in("id", chunk).eq("authors.is_ai", true),
    ]);
    for (const r of links ?? []) cluster.set(r.account_id as string, r.cluster_id as string);
    for (const r of ais ?? []) ai.add(r.id as string);
  }

  const excludedEnv = excludedAccountIds();
  const eff = (id: string) => cluster.get(id) ?? id;
  const excluded = (id: string) => {
    if (includeIds.has(id) || includeIds.has(eff(id))) return false; // self-view override
    return ai.has(id) || excludedEnv.has(id) || excludedEnv.has(eff(id));
  };
  return { eff, excluded };
}

/** address → account_id for the given addresses (proven addresses only). */
export async function addressToAccount(addresses: string[]): Promise<Map<string, string>> {
  const db = adminDb();
  const uniq = Array.from(new Set(addresses));
  const map = new Map<string, string>();
  for (let i = 0; i < uniq.length; i += IN_CHUNK) {
    const chunk = uniq.slice(i, i + IN_CHUNK);
    const { data } = await db.from("account_addresses").select("address, account_id").in("address", chunk);
    for (const r of data ?? []) map.set(r.address as string, r.account_id as string);
  }
  return map;
}

/** author_id → account_id (posts.author_id → the owning account). */
export async function authorToAccount(authorIds: string[]): Promise<Map<string, string>> {
  const db = adminDb();
  const uniq = Array.from(new Set(authorIds));
  const map = new Map<string, string>();
  for (let i = 0; i < uniq.length; i += IN_CHUNK) {
    const chunk = uniq.slice(i, i + IN_CHUNK);
    const { data } = await db.from("accounts").select("id, author_id").in("author_id", chunk);
    for (const r of data ?? []) if (r.author_id) map.set(r.author_id as string, r.id as string);
  }
  return map;
}

/** account_id → display handle (null if none). For leaderboard/reply display. */
export async function handlesFor(accountIds: string[]): Promise<Map<string, string | null>> {
  const db = adminDb();
  const uniq = Array.from(new Set(accountIds));
  const map = new Map<string, string | null>();
  for (let i = 0; i < uniq.length; i += IN_CHUNK) {
    const chunk = uniq.slice(i, i + IN_CHUNK);
    const { data } = await db.from("accounts").select("id, display_handle").in("id", chunk);
    for (const r of data ?? []) map.set(r.id as string, (r.display_handle as string) || null);
  }
  return map;
}

/** account_id → its primary (payout) address. */
export async function primaryAddresses(accountIds: string[]): Promise<Map<string, string>> {
  const db = adminDb();
  const uniq = Array.from(new Set(accountIds));
  const map = new Map<string, string>();
  for (let i = 0; i < uniq.length; i += IN_CHUNK) {
    const chunk = uniq.slice(i, i + IN_CHUNK);
    const { data } = await db.from("account_addresses").select("account_id, address").eq("is_primary", true).in("account_id", chunk);
    for (const r of data ?? []) if (!map.has(r.account_id as string)) map.set(r.account_id as string, r.address as string);
  }
  return map;
}

/** feed_post txid → author_account_id (for reply/quote/reaction/repost targets). */
export async function txidToAuthorAccount(txids: string[]): Promise<Map<string, string>> {
  const db = adminDb();
  const uniq = Array.from(new Set(txids));
  const map = new Map<string, string>();
  for (let i = 0; i < uniq.length; i += IN_CHUNK) {
    const chunk = uniq.slice(i, i + IN_CHUNK);
    const { data } = await db.from("feed_posts").select("txid, author_account_id").in("txid", chunk);
    for (const r of data ?? []) if (r.author_account_id) map.set(r.txid as string, r.author_account_id as string);
  }
  return map;
}
