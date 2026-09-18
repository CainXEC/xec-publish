// =============================================================================
//  lib/powRewards/scoreboard.ts
//  Read surfaces the herald + a self-serve view sit on:
//    • runningScoreboard() — live top-N of the IN-PROGRESS week (week-to-date).
//    • accountScoreLookup() — one account's week-to-date rank + breakdown.
//    • weeklySummary()      — a finalized week's aggregate + top rewardees.
//
//  The live board is EXPENSIVE (it re-scores the week-to-date, incl. an on-chain
//  scan), so the full ranked compute is cached briefly and BOTH the board and the
//  per-account lookup slice that one cache — a page of viewers triggers one scan,
//  not one each.
// =============================================================================

import { weekBoundsFor } from "./isoWeek";
import { loadConfig } from "./config";
import { scoreWeek } from "./score";
import { contributionRows, type ContributionRow } from "./contribution";
import { buildResolver, handlesFor, primaryAddresses } from "./accounts";
import { adminDb } from "@/lib/db";

/** "@handle" if held, else a truncated ecash address — the public display identity. */
function displayIdentity(handle: string | null, address: string | undefined): string {
  if (handle) return `@${handle}`;
  if (address) {
    const bare = address.replace(/^ecash:/, "");
    return `${bare.slice(0, 8)}…${bare.slice(-4)}`;
  }
  return "an eCash writer";
}

interface Board {
  isoWeek: string;
  asOf: string; // ISO timestamp the board was computed for
  rows: ContributionRow[]; // all eligible, ranked desc
}

const BOARD_TTL_MS = 5 * 60_000;
let cache: { at: number; board: Board } | null = null;

/** Full ranked week-to-date board (cached BOARD_TTL_MS). */
async function computeBoard(now: Date): Promise<Board> {
  if (cache && Date.now() - cache.at < BOARD_TTL_MS) return cache.board;
  const cfg = await loadConfig();
  const wk = weekBoundsFor(now);
  // Week-to-date: [week start, now).
  const scores = await scoreWeek(wk.startUtc, now, cfg);
  const { rows } = contributionRows(scores, cfg);
  const board: Board = { isoWeek: wk.isoWeek, asOf: now.toISOString(), rows };
  cache = { at: Date.now(), board };
  return board;
}

export interface ScoreboardEntry {
  rank: number;
  accountId: string;
  handle: string | null;
  /** "@handle" or a truncated address — ready to show in a post. */
  display: string;
  contributionScore: number;
  economicScore: number;
  creationScore: number;
  engagementScore: number;
}
export interface Scoreboard {
  isoWeek: string;
  asOf: string;
  participants: number;
  top: ScoreboardEntry[];
  cutoffScore: number | null; // score of the last shown rank (the bar to beat)
  others: number; // eligible accounts below the shown top
}

/** Live top-N leaderboard for the current (in-progress) week. */
export async function runningScoreboard(topN = 10, now: Date = new Date()): Promise<Scoreboard> {
  const board = await computeBoard(now);
  const shown = board.rows.slice(0, topN);
  const ids = shown.map((r) => r.accountId);
  const [handles, addrs] = await Promise.all([handlesFor(ids), primaryAddresses(ids)]);
  const top: ScoreboardEntry[] = shown.map((r, i) => {
    const handle = handles.get(r.accountId) ?? null;
    return {
      rank: i + 1,
      accountId: r.accountId,
      handle,
      display: displayIdentity(handle, addrs.get(r.accountId)),
      contributionScore: r.contributionScore,
      economicScore: r.economicScore,
      creationScore: r.creationScore,
      engagementScore: r.engagementScore,
    };
  });
  return {
    isoWeek: board.isoWeek,
    asOf: board.asOf,
    participants: board.rows.length,
    top,
    cutoffScore: shown.length ? shown[shown.length - 1].contributionScore : null,
    others: Math.max(0, board.rows.length - shown.length),
  };
}

export interface AccountScoreView {
  found: boolean;
  reason?: "excluded" | "no_activity";
  isoWeek?: string;
  asOf?: string;
  accountId?: string;
  handle?: string | null;
  rank?: number;
  participants?: number;
  contributionScore?: number;
  economicScore?: number;
  creationScore?: number;
  engagementScore?: number;
  activity?: ContributionRow["activity"];
}

/** One account's week-to-date standing (powers "tag the herald" + self-serve). */
export async function accountScoreLookup(accountId: string, now: Date = new Date()): Promise<AccountScoreView> {
  const board = await computeBoard(now);
  const resolver = await buildResolver([accountId]);
  if (resolver.excluded(accountId)) return { found: false, reason: "excluded" };
  const eff = resolver.eff(accountId);
  const idx = board.rows.findIndex((r) => r.accountId === eff);
  if (idx === -1) return { found: false, reason: "no_activity", isoWeek: board.isoWeek, asOf: board.asOf, participants: board.rows.length };
  const r = board.rows[idx];
  const handle = (await handlesFor([eff])).get(eff) ?? null;
  return {
    found: true,
    isoWeek: board.isoWeek,
    asOf: board.asOf,
    accountId: eff,
    handle,
    rank: idx + 1,
    participants: board.rows.length,
    contributionScore: r.contributionScore,
    economicScore: r.economicScore,
    creationScore: r.creationScore,
    engagementScore: r.engagementScore,
    activity: r.activity,
  };
}

export interface WeeklySummary {
  isoWeek: string;
  finalized: boolean;
  paid: boolean;
  totalPow: number;
  recipients: number;
  top: { rank: number; accountId: string; handle: string | null; display: string; pow: number; contributionScore: number; capped: boolean }[];
}

/** A finalized week's aggregate + top rewardees (from the frozen claims). */
export async function weeklySummary(isoWeek: string, topN = 10): Promise<WeeklySummary> {
  const db = adminDb();
  const { data: epoch } = await db.from("pow_reward_epochs").select("status").eq("iso_week", isoWeek).maybeSingle();
  const { data: claims } = await db
    .from("pow_reward_claims")
    .select("account_id, allocation_atoms, contribution_score, capped")
    .eq("iso_week", isoWeek)
    .order("allocation_atoms", { ascending: false });
  const rows = claims ?? [];
  const totalPow = rows.reduce((a, c) => a + (c.allocation_atoms as number), 0);
  const shown = rows.slice(0, topN);
  const ids = shown.map((c) => c.account_id as string);
  const [handles, addrs] = await Promise.all([handlesFor(ids), primaryAddresses(ids)]);
  return {
    isoWeek,
    finalized: !!epoch && ["tallied", "paying", "done"].includes(epoch.status),
    // paid = the payout actually completed (epoch 'done'); the herald announces the
    // weekly rewardees only once this is true, not merely when the tally is frozen.
    paid: epoch?.status === "done",
    totalPow,
    recipients: rows.length,
    top: shown.map((c, i) => {
      const handle = handles.get(c.account_id as string) ?? null;
      return {
        rank: i + 1,
        accountId: c.account_id as string,
        handle,
        display: displayIdentity(handle, addrs.get(c.account_id as string)),
        pow: c.allocation_atoms as number,
        contributionScore: (c.contribution_score as number) ?? 0,
        capped: (c.capped as boolean) ?? false,
      };
    }),
  };
}
