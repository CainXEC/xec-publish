// =============================================================================
//  lib/powRewards/score.ts
//  Compute each eligible account's three raw Contribution-Score components for a
//  week (see docs/pow-token-migration-plan.md §§2–12). READ-ONLY.
//
//    Economic   = sqrt(platform XEC generated)   — on-chain platform+mint receipts
//                 (diminishing returns; a whale mint can't dominate).
//    Creation   = Σ per-category creation points, each category capped per week.
//    Engagement = cross-user interactions (unlock/reply/quote/repost/reaction),
//                 credited to BOTH the actor (participation) and the content owner
//                 (impact), with same-cluster excluded and a repeat-counterparty
//                 decay so breadth of genuine users beats hammering one account.
//
//  Everything keys on the EFFECTIVE account (cluster) via accounts.ts, and is_ai /
//  founder / alt-cluster accounts never earn. Normalisation, weighting, the 10%
//  cap and rounding happen in freezeWeek.ts — this stays pure measurement.
// =============================================================================

import { adminDb } from "@/lib/db";
import type { RewardConfig } from "./config";
import { tallyWeekRevenue } from "./tallyWeek";
import { buildResolver, addressToAccount, authorToAccount, txidToAuthorAccount } from "./accounts";

const IN_CHUNK = 100;

export interface Activity {
  platformXec: number;
  articles: number;
  feedPosts: number;
  replies: number;
  quotes: number;
  reposts: number;
  unlocksMade: number;
  unlocksReceived: number;
  uniqueCounterparties: number;
}
export interface AccountScore {
  accountId: string; // effective (cluster) account
  economicRaw: number;
  creationRaw: number;
  engagementRaw: number;
  activity: Activity;
}

interface FeedPostRow { action: number; author_account_id: string | null; parent_txid: string | null; quoted_txid: string | null; created_at: string }
interface ArticleRow { author_id: string | null; published_at: string | null }
interface FeedEventRow { action: number; actor_account_id: string | null; target_txid: string | null; emoji: string | null; created_at: string }
interface UnlockRow { payer_address: string | null; post_id: string | null; unlocked_at: string }

function emptyActivity(): Activity {
  return { platformXec: 0, articles: 0, feedPosts: 0, replies: 0, quotes: 0, reposts: 0, unlocksMade: 0, unlocksReceived: 0, uniqueCounterparties: 0 };
}

export async function scoreWeek(startUtc: Date, endUtc: Date, cfg: RewardConfig): Promise<Map<string, AccountScore>> {
  const db = adminDb();
  const startISO = startUtc.toISOString();
  const endISO = endUtc.toISOString();

  // ---- Economic: on-chain platform+mint XEC per effective account ----
  const econTally = await tallyWeekRevenue(startUtc, endUtc); // already excluded/clustered
  const econ = econTally.perAccount; // Map<effAccount, sats>

  // ---- Pull the week's creation + engagement rows ----
  const [{ data: fpostsData }, { data: articlesData }, { data: feventsData }, { data: unlocksData }] = await Promise.all([
    db.from("feed_posts").select("action, author_account_id, parent_txid, quoted_txid, created_at").gte("created_at", startISO).lt("created_at", endISO).is("deleted_at", null),
    db.from("posts").select("author_id, published_at").eq("published", true).gte("published_at", startISO).lt("published_at", endISO),
    db.from("feed_events").select("action, actor_account_id, target_txid, emoji, created_at").gte("created_at", startISO).lt("created_at", endISO),
    db.from("unlocks").select("payer_address, post_id, unlocked_at").gte("unlocked_at", startISO).lt("unlocked_at", endISO),
  ]);
  const fposts = (fpostsData ?? []) as FeedPostRow[];
  const articles = (articlesData ?? []) as ArticleRow[];
  const fevents = (feventsData ?? []) as FeedEventRow[];
  const unlocks = (unlocksData ?? []) as UnlockRow[];

  // post_id -> author_id (for unlock counterparty = article author)
  const unlockPostIds = unlocks.map((u) => u.post_id).filter((x): x is string => !!x);
  const postAuthorId = new Map<string, string>();
  for (let i = 0; i < unlockPostIds.length; i += IN_CHUNK) {
    const chunk = Array.from(new Set(unlockPostIds)).slice(i, i + IN_CHUNK);
    if (!chunk.length) break;
    const { data } = await db.from("posts").select("id, author_id").in("id", chunk);
    for (const r of data ?? []) if (r.author_id) postAuthorId.set(r.id as string, r.author_id as string);
  }

  // Resolve the various id spaces to accounts
  const authorAcct = await authorToAccount([
    ...articles.map((a) => a.author_id).filter((x): x is string => !!x),
    ...Array.from(postAuthorId.values()),
  ]);
  const payerAcct = await addressToAccount(unlocks.map((u) => u.payer_address).filter((x): x is string => !!x));
  const targetTxids = [
    ...fposts.filter((p) => p.action === 2 && p.parent_txid).map((p) => p.parent_txid as string),
    ...fposts.filter((p) => p.action === 3 && p.quoted_txid).map((p) => p.quoted_txid as string),
    ...fevents.filter((e) => e.target_txid).map((e) => e.target_txid as string),
  ];
  const txAuthorAcct = await txidToAuthorAccount(targetTxids);

  // Every account id we might touch → resolver (clusters + exclusions)
  const allAccts = new Set<string>();
  for (const k of econ.keys()) allAccts.add(k);
  for (const p of fposts) if (p.author_account_id) allAccts.add(p.author_account_id);
  for (const e of fevents) if (e.actor_account_id) allAccts.add(e.actor_account_id);
  for (const v of authorAcct.values()) allAccts.add(v);
  for (const v of payerAcct.values()) allAccts.add(v);
  for (const v of txAuthorAcct.values()) allAccts.add(v);
  const R = await buildResolver(Array.from(allAccts));

  const scores = new Map<string, AccountScore>();
  const ensure = (effId: string): AccountScore => {
    let s = scores.get(effId);
    if (!s) { s = { accountId: effId, economicRaw: 0, creationRaw: 0, engagementRaw: 0, activity: emptyActivity() }; scores.set(effId, s); }
    return s;
  };
  // Resolve a raw account to its (non-excluded) score row, or null if it can't earn.
  const rowFor = (rawAcct: string | null | undefined): AccountScore | null => {
    if (!rawAcct || R.excluded(rawAcct)) return null;
    return ensure(R.eff(rawAcct));
  };

  // ---- Economic ----
  for (const [effAcct, sats] of econ) {
    if (R.excluded(effAcct)) continue;
    const s = ensure(R.eff(effAcct));
    s.activity.platformXec = sats / 100;
    s.economicRaw = Math.sqrt(sats / 100);
  }

  // ---- Creation (counts now; cap + points applied after) ----
  for (const a of articles) {
    const s = rowFor(authorAcct.get(a.author_id ?? ""));
    if (s) s.activity.articles += 1;
  }
  for (const p of fposts) {
    const s = rowFor(p.author_account_id);
    if (!s) continue;
    if (p.action === 1) s.activity.feedPosts += 1;
    else if (p.action === 2) s.activity.replies += 1;
    else if (p.action === 3) s.activity.quotes += 1;
  }
  for (const e of fevents) {
    if (e.action === 4) { const s = rowFor(e.actor_account_id); if (s) s.activity.reposts += 1; }
  }
  const cap = cfg.creationCategoryCap;
  const cp = cfg.creationPoints;
  for (const s of scores.values()) {
    s.creationRaw =
      Math.min(s.activity.articles * cp.article, cap) +
      Math.min(s.activity.feedPosts * cp.feedPost, cap) +
      Math.min(s.activity.replies * cp.reply, cap) +
      Math.min(s.activity.quotes * cp.quote, cap) +
      Math.min(s.activity.reposts * cp.repost, cap);
  }

  // ---- Engagement (cross-user, decayed per repeated counterparty) ----
  interface Interaction { ts: number; actor: string; owner: string; points: number; kind: "unlock" | "other" }
  const ints: Interaction[] = [];
  const ep = cfg.engagementPoints;
  for (const u of unlocks) {
    const actor = payerAcct.get(u.payer_address ?? "");
    const authorId = postAuthorId.get(u.post_id ?? "");
    const owner = authorId ? authorAcct.get(authorId) : undefined;
    if (actor && owner) ints.push({ ts: Date.parse(u.unlocked_at), actor, owner, points: ep.unlock, kind: "unlock" });
  }
  for (const p of fposts) {
    if (p.action === 2 && p.parent_txid) {
      const owner = txAuthorAcct.get(p.parent_txid);
      if (p.author_account_id && owner) ints.push({ ts: Date.parse(p.created_at), actor: p.author_account_id, owner, points: ep.reply, kind: "other" });
    } else if (p.action === 3 && p.quoted_txid) {
      const owner = txAuthorAcct.get(p.quoted_txid);
      if (p.author_account_id && owner) ints.push({ ts: Date.parse(p.created_at), actor: p.author_account_id, owner, points: ep.quote, kind: "other" });
    }
  }
  for (const e of fevents) {
    if (!e.target_txid || !e.actor_account_id) continue;
    const owner = txAuthorAcct.get(e.target_txid);
    if (!owner) continue;
    if (e.action === 4) ints.push({ ts: Date.parse(e.created_at), actor: e.actor_account_id, owner, points: ep.repost, kind: "other" });
    else if (e.action === 5 && e.emoji !== "👎") ints.push({ ts: Date.parse(e.created_at), actor: e.actor_account_id, owner, points: ep.reaction, kind: "other" });
  }
  ints.sort((a, b) => a.ts - b.ts);

  // decay per (account, counterparty) pair; credit both sides
  const pairCount = new Map<string, Map<string, number>>();
  const uniqueCp = new Map<string, Set<string>>();
  const decayAt = (n: number) => cfg.repeatDecay[Math.min(n, cfg.repeatDecay.length - 1)];
  const credit = (rawAcct: string, otherRaw: string, points: number, isUnlock: boolean, role: "made" | "received" | null) => {
    if (R.excluded(rawAcct) || R.excluded(otherRaw)) return;
    const a = R.eff(rawAcct);
    const o = R.eff(otherRaw);
    if (a === o) return; // self / same cluster
    const s = ensure(a);
    let m = pairCount.get(a);
    if (!m) { m = new Map(); pairCount.set(a, m); }
    const n = m.get(o) ?? 0;
    m.set(o, n + 1);
    s.engagementRaw += points * decayAt(n);
    let set = uniqueCp.get(a);
    if (!set) { set = new Set(); uniqueCp.set(a, set); }
    set.add(o);
    if (isUnlock && role === "made") s.activity.unlocksMade += 1;
    if (isUnlock && role === "received") s.activity.unlocksReceived += 1;
  };
  for (const it of ints) {
    credit(it.actor, it.owner, it.points, it.kind === "unlock", "made"); // participation
    credit(it.owner, it.actor, it.points, it.kind === "unlock", "received"); // impact
  }
  for (const [a, set] of uniqueCp) { const s = scores.get(a); if (s) s.activity.uniqueCounterparties = set.size; }

  // Drop rows with no contribution at all (e.g. an account that only appeared as a
  // same-cluster counterparty).
  for (const [k, s] of scores) {
    if (s.economicRaw === 0 && s.creationRaw === 0 && s.engagementRaw === 0) scores.delete(k);
  }
  return scores;
}
