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
  /** Exclusion gate used to drop rows. With `includeAll` (the for-fun display /
   *  herald board) only the house AI bots (is_ai) are excluded — every real
   *  account, founder included, is kept; otherwise it's the full is_ai / founder /
   *  env rule. */
  excluded: (accountId: string) => boolean;
  /** Same rule as `excluded`: under `includeAll` only is_ai is excluded, so a real
   *  account's interactions credit the counterparty (score.ts skips interactions
   *  touching a rewardExcluded account — i.e. ones involving a bot). */
  rewardExcluded: (accountId: string) => boolean;
}

/** Build a resolver over the given account ids (clusters + is_ai + env excludes).
 *  `includeAll` = include everyone in the tally regardless of exclusion (the
 *  display scoreboard: show every account's score, even the founder/house, who
 *  are still tagged `rewardExcluded` so they never actually earn). The real
 *  payout leaves it false. */
export async function buildResolver(
  accountIds: string[],
  includeAll = false,
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
  // The full exclusion rule (is_ai house accounts / founder / env list).
  const isExcluded = (id: string) =>
    ai.has(id) || excludedEnv.has(id) || excludedEnv.has(eff(id));
  // `includeAll` is the for-fun display/herald board: include every REAL account —
  // the founder (@cain) and the env-listed ones too, so they're scored, their
  // interactions credit the counterparty, and they're shown — but STILL keep the
  // house AI bots (is_ai) off, the same way they're kept out of feed ranking
  // (an [AI] agent shouldn't top a "who's scoring most" board). The rewards
  // program is retired; this board is bragging-rights only. The payout path
  // leaves includeAll false, so the full rule still stands there if ever run.
  const rewardExcluded = (id: string) => (includeAll ? ai.has(id) : isExcluded(id));
  const excluded = rewardExcluded;
  return { eff, excluded, rewardExcluded };
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
