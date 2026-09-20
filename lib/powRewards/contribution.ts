// =============================================================================
//  lib/powRewards/contribution.ts
//  Turn raw component scores into weighted Contribution rows — the ONE place the
//  Economic/Creation/Engagement → Contribution math lives, shared by the freeze
//  (allocation) and the scoreboard (ranking) so they can never drift.
//
//    contribShareRaw = w.econ·(econRaw/Σecon) + w.crea·(creRaw/Σcrea)
//                    + w.eng·(engRaw/Σeng)
//
//  Each component is normalized to the account's SHARE of that component's weekly
//  total, so each dimension controls exactly its weight of the pool regardless of
//  the raw units. Display scores are scaled by SCORE_SCALE for readability.
// =============================================================================

import type { AccountScore, Activity } from "./score";
import type { RewardConfig } from "./config";

export const SCORE_SCALE = 1000;

export interface ContributionRow {
  accountId: string; // effective (cluster) account
  economicScore: number; // display points = weight·share·SCALE
  creationScore: number;
  engagementScore: number;
  contributionScore: number; // sum of the three (display)
  contribShareRaw: number; // weighted share (pre-normalization) — used for allocation
  // true = founder/house/excluded: shown on the display board for reference but
  // never eligible to earn. Only ever true on the all-accounts display board; the
  // payout board contains no such rows.
  excluded: boolean;
  activity: Activity;
}

export interface ContributionResult {
  rows: ContributionRow[]; // sorted desc by contributionScore
  totalContribShareRaw: number; // Σ contribShareRaw across rows
  totals: { economic: number; creation: number; engagement: number; contribution: number };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function contributionRows(scores: Map<string, AccountScore>, cfg: RewardConfig): ContributionResult {
  // Normalise each component over the ELIGIBLE (earning) accounts only. On the
  // payout board every row is eligible, so this is a no-op there. On the display
  // board it keeps an eligible account's score identical to its payout basis —
  // adding the founder/house rows for reference never dilutes everyone else's
  // numbers. An excluded account is then scored against that same eligible total
  // (its share can exceed a weight — that's honest: it out-contributed the pool).
  let tEcon = 0, tCre = 0, tEng = 0;
  for (const s of scores.values()) {
    if (s.rewardExcluded) continue;
    tEcon += s.economicRaw; tCre += s.creationRaw; tEng += s.engagementRaw;
  }
  const w = cfg.weights;

  const rows: ContributionRow[] = [];
  let total = 0;
  for (const s of scores.values()) {
    const econ = w.economic * (tEcon > 0 ? s.economicRaw / tEcon : 0);
    const cre = w.creation * (tCre > 0 ? s.creationRaw / tCre : 0);
    const eng = w.engagement * (tEng > 0 ? s.engagementRaw / tEng : 0);
    const contrib = econ + cre + eng;
    if (contrib <= 0) continue;
    rows.push({
      accountId: s.accountId,
      economicScore: r2(econ * SCORE_SCALE),
      creationScore: r2(cre * SCORE_SCALE),
      engagementScore: r2(eng * SCORE_SCALE),
      contributionScore: r2(contrib * SCORE_SCALE),
      contribShareRaw: contrib,
      excluded: s.rewardExcluded,
      activity: s.activity,
    });
    // Allocation total counts eligible rows only (excluded rows never earn).
    if (!s.rewardExcluded) total += contrib;
  }
  rows.sort((a, b) => b.contributionScore - a.contributionScore);
  return {
    rows,
    totalContribShareRaw: total,
    totals: {
      economic: r2(w.economic * SCORE_SCALE),
      creation: r2(w.creation * SCORE_SCALE),
      engagement: r2(w.engagement * SCORE_SCALE),
      contribution: r2(total * SCORE_SCALE),
    },
  };
}
