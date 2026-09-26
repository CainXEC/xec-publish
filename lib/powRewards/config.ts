// =============================================================================
//  lib/powRewards/config.ts
//  Tunable reward parameters (§23/§27). Loaded from pow_reward_config('active')
//  so pool/weights/points change WITHOUT a deploy; DEFAULT_CONFIG is the fallback
//  + the shape. Each frozen epoch snapshots the exact config it used.
//
//  Scoring model (see score.ts): there is NO reward for the act of creating.
//  Every cross-user interaction (unlock / reply / quote / repost / reaction /
//  comment / comment-reply / comment-like) credits TWO people with the SAME
//  points, from interactionPoints:
//     • the ACTOR (you engaging someone)      → ENGAGEMENT
//     • the content OWNER (you being engaged) → CREATION
//  So "creation" = the value your work drew (engagement received) and
//  "engagement" = the value you gave others (engagement made). Unlocks are the
//  core loop, so they're worth the most.
// =============================================================================

import { adminDb } from "@/lib/db";

/** Points per cross-user interaction type. Each interaction awards this to BOTH
 *  the actor (as engagement) and the content owner (as creation). */
export interface InteractionPoints {
  unlock: number; // pay to read an article — the core loop, worth the most
  comment: number; // top-level comment on an article
  commentReply: number; // reply to a comment
  quote: number; // quote-post of a feed post
  reply: number; // reply to a feed post
  commentLike: number; // paid like on a comment
  repost: number; // repost of a feed post
  reaction: number; // emoji reaction on a feed post
}

export interface RewardConfig {
  /** Weekly POW pool in atoms (POW is 0-decimal → whole tokens). */
  weeklyPoolAtoms: number;
  /** Must sum to 1.0 — the share of the pool each dimension controls. */
  weights: { economic: number; creation: number; engagement: number };
  economicCurve: "sqrt"; // only sqrt for now
  /** Points per cross-user interaction (see InteractionPoints). */
  interactionPoints: InteractionPoints;
  /** Repeat-counterparty decay: the Nth interaction between the SAME two
   *  accounts this week is worth repeatDecay[min(N, len-1)] (favours breadth of
   *  genuine users over hammering one account — applies to BOTH the actor's
   *  engagement and the owner's creation from that interaction). */
  repeatDecay: number[];
  /** Anti-farming: the ENGAGEMENT dimension (what you GIVE — unlocking, replying,
   *  commenting on others) gets diminishing returns above this raw-point knee.
   *  Below it, engagement counts linearly; above it, it grows as sqrt(knee·raw),
   *  so mass-unlocking/commenting can't linearly buy the leaderboard. CREATION
   *  (being engaged WITH) stays linear — being widely read is the signal we want.
   *  0 disables the curve. ~150 ≈ ten full-value unlocks in a week. */
  engagementSoftCapRaw: number;
  /** A comment (article comment or comment-reply) must have at least this many
   *  trimmed characters to earn ANY scoring points, on either side — a one-word
   *  "nice" shouldn't move rank. It still posts and still pays the author. */
  minCommentChars: number;
  /** Hard cap: no account gets more than this fraction of the pool. */
  maxUserShare: number;
  /** Loyalty multiplier ceiling (Phase 3; unused = 1.0 for now). */
  loyaltyMultMax: number;
}

export const DEFAULT_CONFIG: RewardConfig = {
  weeklyPoolAtoms: 1000,
  // Economy 20%, creation + engagement 40% each. Creation (engagement your work
  // received) and engagement (engagement you gave) are two sides of the same
  // interactions, so weighting them equally keeps making valued things and
  // showing up for others in balance.
  weights: { economic: 0.2, creation: 0.4, engagement: 0.4 },
  economicCurve: "sqrt",
  // Unlocks lead by a wide margin — paying to read a whole article is the
  // strongest signal of value on the platform. Comments (real writing about
  // writing) beat feed quotes/replies, which beat one-tap reposts/reactions.
  interactionPoints: { unlock: 15, comment: 5, commentReply: 4, quote: 4, reply: 3, commentLike: 2, repost: 2, reaction: 1 },
  repeatDecay: [1.0, 0.5, 0.25, 0.1],
  engagementSoftCapRaw: 150,
  minCommentChars: 15,
  maxUserShare: 0.1,
  loyaltyMultMax: 1.2,
};

/** Load the live config, shallow-merged over DEFAULT_CONFIG (so a partial row in
 *  the DB still yields a complete config). Falls back to DEFAULT on any error. */
export async function loadConfig(): Promise<RewardConfig> {
  try {
    const { data } = await adminDb().from("pow_reward_config").select("config").eq("id", "active").maybeSingle();
    const c = (data?.config ?? {}) as Partial<RewardConfig>;
    return {
      ...DEFAULT_CONFIG,
      ...c,
      weights: { ...DEFAULT_CONFIG.weights, ...(c.weights ?? {}) },
      interactionPoints: { ...DEFAULT_CONFIG.interactionPoints, ...(c.interactionPoints ?? {}) },
      repeatDecay: c.repeatDecay ?? DEFAULT_CONFIG.repeatDecay,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}
