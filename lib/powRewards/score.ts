// =============================================================================
//  lib/powRewards/score.ts
//  Compute each eligible account's three raw Contribution-Score components for a
//  week (see docs/pow-token-migration-plan.md §§2–12). READ-ONLY.
//
//    Economic   = sqrt(platform XEC generated)   — on-chain platform+mint receipts
//                 (diminishing returns; a whale mint can't dominate).
//    Creation   = the value your work DREW: for every cross-user interaction where
//                 you are the content OWNER (someone unlocks/replies/quotes/reposts/
//                 reacts to your post, or comments/likes-a-comment on your article),
//                 you earn that interaction's points. Nothing is awarded for the
//                 mere act of posting/publishing — only for engagement received.
//    Engagement = the value you GAVE others: the same interactions credited to the
//                 ACTOR side (you doing the unlocking/replying/quoting/commenting/…).
//
//  So one interaction credits TWO accounts with the SAME points: the actor's
//  engagement and the owner's creation. Both sides share one repeat-counterparty
//  decay (keyed actor→owner) so breadth of genuine users beats hammering one
//  account. Same-cluster / self interactions are dropped; is_ai / founder /
//  alt-cluster accounts never earn. Weighting, the 10% cap and rounding happen in
//  contribution.ts / freezeWeek.ts — this stays pure measurement.
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
  comments: number; // article comments you made
  unlocksMade: number;
  unlocksReceived: number;
  uniqueCounterparties: number;
}
export interface AccountScore {
  accountId: string; // effective (cluster) account
  economicRaw: number;
  creationRaw: number; // engagement your work RECEIVED (owner side)
  engagementRaw: number; // engagement you GAVE others (actor side)
  // true = founder/house/env-excluded (can't earn). Only ever set when scoring
  // with includeAll (the display board); the payout board drops these rows so it
  // never appears there. Downstream normalisation/tagging reads it.
  rewardExcluded: boolean;
  activity: Activity;
}

interface FeedPostRow { action: number; author_account_id: string | null; parent_txid: string | null; quoted_txid: string | null; created_at: string }
interface ArticleRow { author_id: string | null; published_at: string | null }
interface FeedEventRow { action: number; actor_account_id: string | null; target_txid: string | null; emoji: string | null; created_at: string }
interface UnlockRow { payer_address: string | null; post_id: string | null; unlocked_at: string }
interface CommentRow { action: number | null; author_account_id: string | null; post_id: string | null; parent_txid: string | null; txid: string | null; content: string | null; created_at: string }
interface CommentEventRow { action: number; actor_account_id: string | null; target_txid: string | null; created_at: string }

function emptyActivity(): Activity {
  return { platformXec: 0, articles: 0, feedPosts: 0, replies: 0, quotes: 0, reposts: 0, comments: 0, unlocksMade: 0, unlocksReceived: 0, uniqueCounterparties: 0 };
}

export async function scoreWeek(
  startUtc: Date,
  endUtc: Date,
  cfg: RewardConfig,
  includeAll = false, // display board: score EVERY account (excluded ones tagged, not dropped)
): Promise<Map<string, AccountScore>> {
  const db = adminDb();
  const startISO = startUtc.toISOString();
  const endISO = endUtc.toISOString();

  // ---- Economic: on-chain platform+mint XEC per effective account ----
  const econTally = await tallyWeekRevenue(startUtc, endUtc, includeAll); // excluded/clustered unless includeAll
  const econ = econTally.perAccount; // Map<effAccount, sats>

  // ---- Pull the week's rows (creation-context counts + all interactions) ----
  const [{ data: fpostsData }, { data: articlesData }, { data: feventsData }, { data: unlocksData }, { data: commentsData }, { data: ceventsData }] = await Promise.all([
    db.from("feed_posts").select("action, author_account_id, parent_txid, quoted_txid, created_at").gte("created_at", startISO).lt("created_at", endISO).is("deleted_at", null),
    db.from("posts").select("author_id, published_at").eq("published", true).gte("published_at", startISO).lt("published_at", endISO),
    db.from("feed_events").select("action, actor_account_id, target_txid, emoji, created_at").gte("created_at", startISO).lt("created_at", endISO),
    db.from("unlocks").select("payer_address, post_id, unlocked_at").gte("unlocked_at", startISO).lt("unlocked_at", endISO),
    db.from("comments").select("action, author_account_id, post_id, parent_txid, txid, content, created_at").gte("created_at", startISO).lt("created_at", endISO).not("txid", "is", null).is("deleted_at", null),
    db.from("comment_events").select("action, actor_account_id, target_txid, created_at").gte("created_at", startISO).lt("created_at", endISO),
  ]);
  const fposts = (fpostsData ?? []) as FeedPostRow[];
  const articles = (articlesData ?? []) as ArticleRow[];
  const fevents = (feventsData ?? []) as FeedEventRow[];
  const unlocks = (unlocksData ?? []) as UnlockRow[];
  const comments = (commentsData ?? []) as CommentRow[];
  const cevents = (ceventsData ?? []) as CommentEventRow[];

  // post_id -> author_id, for unlock + top-level-comment counterparty (article author)
  const postIdsToResolve = new Set<string>([
    ...unlocks.map((u) => u.post_id).filter((x): x is string => !!x),
    ...comments.filter((c) => c.action === 10 && c.post_id).map((c) => c.post_id as string),
  ]);
  const postAuthorId = new Map<string, string>();
  {
    const ids = Array.from(postIdsToResolve);
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      const chunk = ids.slice(i, i + IN_CHUNK);
      if (!chunk.length) break;
      const { data } = await db.from("posts").select("id, author_id").in("id", chunk);
      for (const r of data ?? []) if (r.author_id) postAuthorId.set(r.id as string, r.author_id as string);
    }
  }

  // comment txid -> author_account_id, for comment-reply + comment-like counterparty
  // (the parent comment's / liked comment's author). Parents may predate the week,
  // so resolve them explicitly rather than only from this week's `comments`.
  const commentTxidsToResolve = new Set<string>([
    ...comments.filter((c) => c.action === 11 && c.parent_txid).map((c) => c.parent_txid as string),
    ...cevents.filter((e) => e.target_txid).map((e) => e.target_txid as string),
  ]);
  const commentAuthorByTxid = new Map<string, string>();
  {
    const ids = Array.from(commentTxidsToResolve);
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      const chunk = ids.slice(i, i + IN_CHUNK);
      if (!chunk.length) break;
      const { data } = await db.from("comments").select("txid, author_account_id").in("txid", chunk);
      for (const r of data ?? []) if (r.txid && r.author_account_id) commentAuthorByTxid.set(r.txid as string, r.author_account_id as string);
    }
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
  for (const c of comments) if (c.author_account_id) allAccts.add(c.author_account_id);
  for (const e of cevents) if (e.actor_account_id) allAccts.add(e.actor_account_id);
  for (const v of authorAcct.values()) allAccts.add(v);
  for (const v of payerAcct.values()) allAccts.add(v);
  for (const v of txAuthorAcct.values()) allAccts.add(v);
  for (const v of commentAuthorByTxid.values()) allAccts.add(v);
  const R = await buildResolver(Array.from(allAccts), includeAll);

  const scores = new Map<string, AccountScore>();
  const ensure = (effId: string): AccountScore => {
    let s = scores.get(effId);
    if (!s) { s = { accountId: effId, economicRaw: 0, creationRaw: 0, engagementRaw: 0, rewardExcluded: R.rewardExcluded(effId), activity: emptyActivity() }; scores.set(effId, s); }
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

  // ---- Activity counts (DISPLAY ONLY — no points for the act of creating) ----
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
  for (const c of comments) {
    const s = rowFor(c.author_account_id);
    if (s) s.activity.comments += 1;
  }

  // ---- Interactions: each credits the actor (engagement) + owner (creation) ----
  interface Interaction { ts: number; actor: string; owner: string; points: number; kind: "unlock" | "other" }
  const ints: Interaction[] = [];
  const ip = cfg.interactionPoints;
  // Unlocks: reader (actor) ↔ article author (owner)
  for (const u of unlocks) {
    const actor = payerAcct.get(u.payer_address ?? "");
    const authorId = postAuthorId.get(u.post_id ?? "");
    const owner = authorId ? authorAcct.get(authorId) : undefined;
    if (actor && owner) ints.push({ ts: Date.parse(u.unlocked_at), actor, owner, points: ip.unlock, kind: "unlock" });
  }
  // Feed replies / quotes: post author (actor) ↔ target post author (owner)
  for (const p of fposts) {
    if (p.action === 2 && p.parent_txid) {
      const owner = txAuthorAcct.get(p.parent_txid);
      if (p.author_account_id && owner) ints.push({ ts: Date.parse(p.created_at), actor: p.author_account_id, owner, points: ip.reply, kind: "other" });
    } else if (p.action === 3 && p.quoted_txid) {
      const owner = txAuthorAcct.get(p.quoted_txid);
      if (p.author_account_id && owner) ints.push({ ts: Date.parse(p.created_at), actor: p.author_account_id, owner, points: ip.quote, kind: "other" });
    }
  }
  // Feed reposts / reactions: actor ↔ target post author (owner)
  for (const e of fevents) {
    if (!e.target_txid || !e.actor_account_id) continue;
    const owner = txAuthorAcct.get(e.target_txid);
    if (!owner) continue;
    if (e.action === 4) ints.push({ ts: Date.parse(e.created_at), actor: e.actor_account_id, owner, points: ip.repost, kind: "other" });
    else if (e.action === 5 && e.emoji !== "👎") ints.push({ ts: Date.parse(e.created_at), actor: e.actor_account_id, owner, points: ip.reaction, kind: "other" });
  }
  // Article comments: commenter (actor) ↔ article author / parent-comment author (owner).
  // A too-short comment (a one-word "nice") earns nothing on either side — it still
  // posts and pays the author, it just doesn't move the leaderboard.
  const minCommentChars = cfg.minCommentChars ?? 0;
  for (const c of comments) {
    if (!c.author_account_id) continue;
    if (minCommentChars > 0 && [...(c.content ?? "").trim()].length < minCommentChars) continue;
    if (c.action === 10) {
      const authorId = postAuthorId.get(c.post_id ?? "");
      const owner = authorId ? authorAcct.get(authorId) : undefined;
      if (owner) ints.push({ ts: Date.parse(c.created_at), actor: c.author_account_id, owner, points: ip.comment, kind: "other" });
    } else if (c.action === 11 && c.parent_txid) {
      const owner = commentAuthorByTxid.get(c.parent_txid);
      if (owner) ints.push({ ts: Date.parse(c.created_at), actor: c.author_account_id, owner, points: ip.commentReply, kind: "other" });
    }
  }
  // Comment likes: liker (actor) ↔ liked comment's author (owner)
  for (const e of cevents) {
    if (e.action !== 5 || !e.actor_account_id || !e.target_txid) continue;
    const owner = commentAuthorByTxid.get(e.target_txid);
    if (owner) ints.push({ ts: Date.parse(e.created_at), actor: e.actor_account_id, owner, points: ip.commentLike, kind: "other" });
  }
  ints.sort((a, b) => a.ts - b.ts);

  // Decay per (actor→owner) pair; one interaction credits the actor's engagement
  // AND the owner's creation with the SAME decayed points (so repeat farming
  // between the same two accounts fades on both sides).
  const pairCount = new Map<string, Map<string, number>>();
  const uniqueCp = new Map<string, Set<string>>();
  const decayAt = (n: number) => cfg.repeatDecay[Math.min(n, cfg.repeatDecay.length - 1)];
  const noteCp = (a: string, o: string) => { let set = uniqueCp.get(a); if (!set) { set = new Set(); uniqueCp.set(a, set); } set.add(o); };
  for (const it of ints) {
    // Use the TRUE exclusion rule (rewardExcluded), NOT the includeAll-aware
    // excluded(): a founder/is_ai account must never credit the OTHER party — on
    // the display board OR the payout — else interacting with an excluded account
    // would inflate a user's SHOWN rank above what they're actually paid. When
    // includeAll is off these are identical, so the payout is unchanged; this only
    // brings the display board (includeAll=true) into line with it.
    if (R.rewardExcluded(it.actor) || R.rewardExcluded(it.owner)) continue;
    const a = R.eff(it.actor);
    const o = R.eff(it.owner);
    if (a === o) continue; // self / same cluster
    let m = pairCount.get(a);
    if (!m) { m = new Map(); pairCount.set(a, m); }
    const n = m.get(o) ?? 0;
    m.set(o, n + 1);
    const pts = it.points * decayAt(n);
    ensure(a).engagementRaw += pts; // actor: value GIVEN
    ensure(o).creationRaw += pts; // owner: value RECEIVED
    noteCp(a, o);
    noteCp(o, a);
    if (it.kind === "unlock") { ensure(a).activity.unlocksMade += 1; ensure(o).activity.unlocksReceived += 1; }
  }
  for (const [a, set] of uniqueCp) { const s = scores.get(a); if (s) s.activity.uniqueCounterparties = set.size; }

  // Anti-farming: diminishing returns on ENGAGEMENT (the giving side). Below the
  // knee it's linear; above it grows as sqrt(knee·raw) — concave, so unlocking/
  // commenting on ever more accounts yields ever less rank. Creation (being
  // engaged WITH) is intentionally left linear. Same shape as the economic curve.
  const knee = cfg.engagementSoftCapRaw ?? 0;
  if (knee > 0) {
    for (const s of scores.values()) {
      if (s.engagementRaw > knee) s.engagementRaw = Math.sqrt(knee * s.engagementRaw);
    }
  }

  // Drop rows with no contribution at all (e.g. an account that only appeared as a
  // same-cluster counterparty).
  for (const [k, s] of scores) {
    if (s.economicRaw === 0 && s.creationRaw === 0 && s.engagementRaw === 0) scores.delete(k);
  }
  return scores;
}
