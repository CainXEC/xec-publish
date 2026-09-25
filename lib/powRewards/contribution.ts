// =============================================================================
//  lib/powRewards/contribution.ts
//  Turn raw component scores into weighted Contribution rows — the ONE place the
//  Economic/Creation/Engagement → Contribution math lives, shared by the freeze
//  (allocation) and the scoreboard (ranking) so they can never drift.
//
//    contributionScore = SCALE · ( w.econ·econRaw + w.crea·creRaw + w.eng·engRaw )
//
//  This is an ABSOLUTE, ACCUMULATING score: it is a weighted sum of your own
//  activity points, NOT a share of everyone's total. So it only ever climbs as
//  you do more through the week (it never drops because someone else got busy),
//  and it resets each week because scoring is always week-to-date. The 35/35/30
//  weights keep the three activity types in their intended balance.
//
//  Rewards: the fixed weekly POW pool is still split PRO-RATA by this score
//  (freezeWeek: each earner's allocation ∝ contribShareRaw), so a bigger score is
//  a bigger slice — the pool math is unchanged, only the displayed number is now
//  absolute instead of a normalised 0–1000 share.
// =============================================================================

import type { AccountScore, Activity } from "./score";
import type { RewardConfig } from "./config";

// Display multiplier so the accumulating score reads as chunky "points" (a post
// ≈ 35, an article ≈ 350) rather than small decimals. It cancels out of the
// pro-rata payout, so it only affects the shown number.
export const SCORE_SCALE = 10;

export interface ContributionRow {
  accountId: string; // effective (cluster) account
  economicScore: number; // display points = weight·raw·SCALE
  creationScore: number;
  engagementScore: number;
  contributionScore: number; // sum of the three (display)
  contribShareRaw: number; // un-rounded weighted score — the pro-rata payout basis
  // true = founder/house/excluded: shown to that account for its own reference
  // but never eligible to earn (and filtered off the public scoreboard).
  excluded: boolean;
  activity: Activity;
}

export interface ContributionResult {
  rows: ContributionRow[]; // sorted desc by contributionScore
  totalContribShareRaw: number; // Σ contribShareRaw across ELIGIBLE rows (payout base)
  totals: { economic: number; creation: number; engagement: number; contribution: number };
}

const r0 = (n: number) => Math.round(n);

export function contributionRows(scores: Map<string, AccountScore>, cfg: RewardConfig): ContributionResult {
  const w = cfg.weights;
  const rows: ContributionRow[] = [];
  // Eligible-only running totals (excluded rows never earn, so they don't count
  // toward the payout base or the dimension summary).
  let total = 0;
  let tEcon = 0, tCre = 0, tEng = 0;

  for (const s of scores.values()) {
    const econ = w.economic * s.economicRaw * SCORE_SCALE;
    const cre = w.creation * s.creationRaw * SCORE_SCALE;
    const eng = w.engagement * s.engagementRaw * SCORE_SCALE;
    const contrib = econ + cre + eng;
    if (contrib <= 0) continue;
    rows.push({
      accountId: s.accountId,
      economicScore: r0(econ),
      creationScore: r0(cre),
      engagementScore: r0(eng),
      contributionScore: r0(contrib),
      contribShareRaw: contrib, // un-rounded, for precise pro-rata allocation
      excluded: s.rewardExcluded,
      activity: s.activity,
    });
    if (!s.rewardExcluded) {
      total += contrib;
      tEcon += econ; tCre += cre; tEng += eng;
    }
  }
  rows.sort((a, b) => b.contributionScore - a.contributionScore);
  return {
    rows,
    totalContribShareRaw: total,
    totals: { economic: r0(tEcon), creation: r0(tCre), engagement: r0(tEng), contribution: r0(total) },
  };
}
