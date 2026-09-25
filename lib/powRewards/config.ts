// =============================================================================
//  lib/powRewards/config.ts
//  Tunable reward parameters (§23/§27). Loaded from pow_reward_config('active')
//  so pool/weights/points/cap change WITHOUT a deploy; DEFAULT_CONFIG is the
//  fallback + the shape. Each frozen epoch snapshots the exact config it used.
// =============================================================================

import { adminDb } from "@/lib/db";

export interface RewardConfig {
  /** Weekly POW pool in atoms (POW is 0-decimal → whole tokens). */
  weeklyPoolAtoms: number;
  /** Must sum to 1.0 — the share of the pool each dimension controls. */
  weights: { economic: number; creation: number; engagement: number };
  economicCurve: "sqrt"; // only sqrt for now
  /** Creation points per action. */
  creationPoints: { article: number; feedPost: number; reply: number; repost: number; quote: number };
  /** Per-category weekly ceiling on creation points (anti-spam). */
  creationCategoryCap: number;
  /** Engagement points per cross-user interaction type. */
  engagementPoints: { unlock: number; reply: number; quote: number; repost: number; reaction: number };
  /** Repeat-counterparty decay: Nth interaction with the SAME counterparty this
   *  week is worth repeatDecay[min(N, len-1)] (favours breadth over repetition). */
  repeatDecay: number[];
  /** Hard cap: no account gets more than this fraction of the pool. */
  maxUserShare: number;
  /** Loyalty multiplier ceiling (Phase 3; unused = 1.0 for now). */
  loyaltyMultMax: number;
}

export const DEFAULT_CONFIG: RewardConfig = {
  weeklyPoolAtoms: 1000,
  // Contribution over spend: economy 20%, creation + engagement 40% each. Articles
  // earn their real POW through readership (unlocks credit the author engagement)
  // + XEC directly (94% of reads), so the publish baseline is a modest 20 points.
  weights: { economic: 0.2, creation: 0.4, engagement: 0.4 },
  economicCurve: "sqrt",
  creationPoints: { article: 20, feedPost: 10, reply: 5, repost: 5, quote: 15 },
  creationCategoryCap: 500,
  engagementPoints: { unlock: 10, reply: 3, quote: 4, repost: 2, reaction: 1 },
  repeatDecay: [1.0, 0.5, 0.25, 0.1],
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
      creationPoints: { ...DEFAULT_CONFIG.creationPoints, ...(c.creationPoints ?? {}) },
      engagementPoints: { ...DEFAULT_CONFIG.engagementPoints, ...(c.engagementPoints ?? {}) },
      repeatDecay: c.repeatDecay ?? DEFAULT_CONFIG.repeatDecay,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}
