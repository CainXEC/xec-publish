// =============================================================================
//  lib/powRewards/tallyWeek.ts
//  Weekly reward WEIGHT = XEC the platform address received from each eligible
//  account during the week. See docs/pow-token-migration-plan.md §5.
//
//  Source of truth is what PLATFORM_XEC_ADDRESS actually received on-chain — one
//  scan captures every fee-bearing action (unlocks/posts/reactions/comments/forum
//  fees), each with the platform's EXACT cut, instead of reconstructing per-table
//  split formulas. Attribution is by the tx's sender (first input) → account via
//  account_addresses.
//
//  EXCLUSIONS ("filter before the tally", same philosophy as
//  sql/feed_engagement_signal.sql):
//    • 👎 downvote txs — dropped by txid (feed_events.emoji='👎'); they pay the
//      platform 100% but we don't reward trashing posts.
//    • the platform's OWN txs (it appears as a spender) — change, not revenue.
//    • is_ai house accounts, and the founder/excluded accounts (env).
//    • alts — each account is collapsed to its cluster (account_links); a cluster
//      is one earner.
//
//  Two on-chain revenue sinks are scanned: the platform fee address
//  (PLATFORM_XEC_ADDRESS — unlock/post/reaction/comment/forum cuts) and the mint
//  wallet (MINT_PAYMENT_ADDRESS — NFT mint revenue). Token-bearing outputs are
//  skipped, so a future POW-paid mint's token/dust never counts as XEC revenue.
//
//  READ-ONLY: this module computes, it never writes the DB or sends anything.
// =============================================================================

import { ChronikClient } from "chronik-client";
import { encodeCashAddress } from "ecashaddrjs";
import { adminDb } from "@/lib/db";
import { CHRONIK_URLS } from "@/lib/ecash/chronikEndpoints";

let _chronik: ChronikClient | null = null;
const chronik = () => (_chronik ??= new ChronikClient(CHRONIK_URLS));

// Platform-controlled XEC revenue sinks. Every fee-bearing action (unlocks,
// posts, reactions, comments, forum fees) pays its cut to the platform fee
// address; NFT-mint revenue lands at the mint wallet address. We scan BOTH and
// attribute receipts to the paying account.
const SOURCE_ADDRESSES = [process.env.PLATFORM_XEC_ADDRESS, process.env.MINT_PAYMENT_ADDRESS]
  .map((a) => a?.trim())
  .filter((a): a is string => !!a);

// Accounts that never earn (the founder is the SOURCE of the pool, not a
// recipient). Comma-separated account UUIDs.
function excludedAccountIds(): Set<string> {
  return new Set(
    (process.env.POW_REWARD_EXCLUDED_ACCOUNTS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

// P2PKH: 76a914<20>88ac | P2SH: a914<20>87 -> ecash: address. Mirrors
// lib/mintPayments.ts scriptToAddress (kept local to avoid coupling).
function scriptToAddress(outputScriptHex: string): string | null {
  const s = (outputScriptHex || "").toLowerCase();
  if (s.startsWith("76a914") && s.endsWith("88ac") && s.length === 50) {
    return encodeCashAddress("ecash", "p2pkh", s.slice(6, 46));
  }
  if (s.startsWith("a914") && s.endsWith("87") && s.length === 46) {
    return encodeCashAddress("ecash", "p2sh", s.slice(4, 44));
  }
  return null;
}

interface RawReceipt {
  txid: string;
  sender: string; // first-input address
  sats: number; // total received AT the platform address in this tx
}

// Just the fields the scan reads — chronik-client's Tx type is stricter than we
// need and varies across versions (sats vs value), so we narrow to this shape.
interface ScanTx {
  txid: string;
  timeFirstSeen?: number | string;
  inputs?: { outputScript: string }[];
  // `token` present ⇒ the output carries an eToken (e.g. a POW-paid mint's token
  // output + its 546-sat dust); we count XEC revenue only, so those are skipped.
  outputs?: {
    outputScript: string;
    sats?: number | bigint | string;
    value?: number | bigint | string;
    token?: unknown;
  }[];
}

/** Page one address's history newest-first, collecting every incoming XEC payment
 *  whose timeFirstSeen falls in [startUtc, endUtc). Skips the address's OWN txs
 *  (it is an input) — those are change/operations, not revenue — and skips
 *  token-bearing outputs so only XEC revenue is counted. */
async function scanReceipts(address: string, startUtc: Date, endUtc: Date): Promise<RawReceipt[]> {
  const startSec = Math.floor(startUtc.getTime() / 1000);
  const endSec = Math.floor(endUtc.getTime() / 1000);
  const out: RawReceipt[] = [];
  const PAGE = 200;
  let page = 0;
  // history() is newest-first; stop once we page past the window's start.
  for (;;) {
    const res = await chronik().address(address).history(page, PAGE);
    const txs = (res.txs ?? []) as unknown as ScanTx[];
    if (txs.length === 0) break;
    let allOlder = true;
    for (const tx of txs) {
      const seen = Number(tx.timeFirstSeen ?? 0);
      if (seen >= startSec) allOlder = false;
      if (!seen || seen < startSec || seen >= endSec) continue; // outside window
      // Skip this address's own spends (change back to itself looks like a receipt).
      const isOwnTx = (tx.inputs ?? []).some((i) => scriptToAddress(i.outputScript) === address);
      if (isOwnTx) continue;
      let sats = 0;
      for (const o of tx.outputs ?? []) {
        if (o.token) continue; // token output (e.g. a POW-paid mint) — not XEC revenue
        if (scriptToAddress(o.outputScript) === address) {
          sats += Number(o.sats ?? o.value ?? 0);
        }
      }
      if (sats <= 0) continue;
      const sender = scriptToAddress((tx.inputs ?? [])[0]?.outputScript);
      if (!sender) continue;
      out.push({ txid: tx.txid, sender, sats });
    }
    // Once an entire page predates the window, everything after is older too.
    if (allOlder) break;
    page += 1;
  }
  return out;
}

/** feed_events txids among `txids` that are 👎 downvotes — excluded from the tally. */
async function downvoteTxids(txids: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  const db = adminDb();
  // Chunk the IN() so a big week doesn't blow the query size.
  for (let i = 0; i < txids.length; i += 300) {
    const chunk = txids.slice(i, i + 300);
    const { data, error } = await db
      .from("feed_events")
      .select("txid")
      .eq("emoji", "👎")
      .in("txid", chunk);
    if (error) throw new Error(`downvoteTxids: ${error.message}`);
    for (const r of data ?? []) found.add(r.txid as string);
  }
  return found;
}

export interface WeekTally {
  /** effective account id (cluster representative) -> platform sats that week. */
  perAccount: Map<string, number>;
  totalFeeSats: number;
  receiptCount: number;
  skippedUnattributed: number; // receipts whose sender maps to no account
}

/**
 * Compute each eligible account's revenue weight for [startUtc, endUtc): XEC the
 * platform fee address AND the mint wallet received from that account (fees +
 * mint revenue). Returns a map of effective-account-id → sats. Payout addresses /
 * allocation are resolved by the caller; this stays a pure measurement.
 */
export async function tallyWeekRevenue(startUtc: Date, endUtc: Date): Promise<WeekTally> {
  if (SOURCE_ADDRESSES.length === 0) {
    throw new Error("no reward source addresses set (PLATFORM_XEC_ADDRESS / MINT_PAYMENT_ADDRESS)");
  }
  const db = adminDb();

  const receipts = (
    await Promise.all(SOURCE_ADDRESSES.map((addr) => scanReceipts(addr, startUtc, endUtc)))
  ).flat();
  const dv = await downvoteTxids(receipts.map((r) => r.txid));

  // address -> account_id (proven addresses only; unproven senders can't be paid)
  const senders = Array.from(new Set(receipts.map((r) => r.sender)));
  const addrToAccount = new Map<string, string>();
  for (let i = 0; i < senders.length; i += 300) {
    const chunk = senders.slice(i, i + 300);
    const { data, error } = await db
      .from("account_addresses")
      .select("address, account_id")
      .in("address", chunk);
    if (error) throw new Error(`account_addresses: ${error.message}`);
    for (const r of data ?? []) addrToAccount.set(r.address as string, r.account_id as string);
  }

  const accountIds = Array.from(new Set(Array.from(addrToAccount.values())));

  // account -> cluster (COALESCE(cluster_id, account_id)); default self.
  const cluster = new Map<string, string>();
  for (let i = 0; i < accountIds.length; i += 300) {
    const chunk = accountIds.slice(i, i + 300);
    const { data, error } = await db
      .from("account_links")
      .select("account_id, cluster_id")
      .in("account_id", chunk);
    if (error) throw new Error(`account_links: ${error.message}`);
    for (const r of data ?? []) cluster.set(r.account_id as string, r.cluster_id as string);
  }
  const effAccount = (id: string) => cluster.get(id) ?? id;

  // is_ai house accounts (excluded as earners).
  const aiAccounts = new Set<string>();
  for (let i = 0; i < accountIds.length; i += 300) {
    const chunk = accountIds.slice(i, i + 300);
    const { data, error } = await db
      .from("accounts")
      .select("id, authors!inner(is_ai)")
      .in("id", chunk)
      .eq("authors.is_ai", true);
    if (error) throw new Error(`accounts/is_ai: ${error.message}`);
    for (const r of data ?? []) aiAccounts.add(r.id as string);
  }

  const excluded = excludedAccountIds();

  const perAccount = new Map<string, number>();
  let totalFeeSats = 0;
  let receiptCount = 0;
  let skippedUnattributed = 0;

  for (const r of receipts) {
    if (dv.has(r.txid)) continue; // 👎 downvote — not rewarded
    const acct = addrToAccount.get(r.sender);
    if (!acct) {
      skippedUnattributed += 1;
      continue; // sender not a proven address of any account
    }
    if (aiAccounts.has(acct)) continue; // house/AI supporter
    const eff = effAccount(acct);
    if (excluded.has(acct) || excluded.has(eff)) continue; // founder / excluded
    perAccount.set(eff, (perAccount.get(eff) ?? 0) + r.sats);
    totalFeeSats += r.sats;
    receiptCount += 1;
  }

  return { perAccount, totalFeeSats, receiptCount, skippedUnattributed };
}
