// =============================================================================
//  mintCap.ts
//  The 10,000 hard-cap gate for the handle-NFT collection.
//
//  Two guarantees:
//    1. The count toward 10K does NOT start until the collection is officially
//       LIVE. Pre-launch rehearsal/test mints run uncapped and uncounted, so
//       they never burn into the public supply. The launch switch is the
//       nft_mint_counter.live column — flip it true in Supabase at launch and
//       counting begins from whatever `minted` is (0 on a fresh row).
//    2. Once live, mints auto-pause at sellout: mintCapSoldOut() refuses new
//       mints at minted >= cap, and recordMintAgainstCap() bumps the counter.
//
//  RACE SAFETY: every caller runs INSIDE the global mint_lock (id=1) that both
//  the paid-mint (mintProcessor) and grandfather-claim (claimGrant) paths hold
//  while minting. Because only one mint holds that lock at a time, the
//  check-then-increment sequence here is globally serialized and cannot
//  overshoot the cap — no atomic RPC needed. The increment still pins on the
//  read value as belt-and-suspenders.
//
//  Table nft_mint_counter (single row, id = 1):
//    live   boolean   -- false until launch; gates BOTH counting and capping
//    minted int       -- post-launch mints only
//    cap    int       -- 10000
// =============================================================================

import { adminDb } from "@/lib/db";

const supabase = adminDb();

async function readCounter(): Promise<{ live: boolean; minted: number; cap: number } | null> {
  const { data } = await supabase
    .from("nft_mint_counter")
    .select("live, minted, cap")
    .eq("id", 1)
    .maybeSingle();
  if (!data) return null;
  return { live: Boolean(data.live), minted: Number(data.minted ?? 0), cap: Number(data.cap ?? 10000) };
}

/**
 * Is the collection live AND sold out? Call this under the mint_lock, before
 * broadcasting a child mint. Pre-launch (or a missing/uninitialized row) is
 * never sold out — the cap only bites once `live` is true.
 */
export async function mintCapSoldOut(): Promise<boolean> {
  const c = await readCounter();
  if (!c || !c.live) return false; // pre-launch: uncapped
  return c.minted >= c.cap;
}

/**
 * Count one successful mint against the cap. No-op pre-launch. Call this ONLY
 * after the handle row is committed, under the same mint_lock, so a failed mint
 * never leaves a phantom slot consumed (success-only increment => no rollback).
 */
export async function recordMintAgainstCap(): Promise<void> {
  const c = await readCounter();
  if (!c || !c.live) return; // pre-launch: don't count
  await supabase
    .from("nft_mint_counter")
    .update({ minted: c.minted + 1 })
    .eq("id", 1)
    .eq("minted", c.minted); // pin on the read value (lock already serializes us)
}

/**
 * Public read of mint progress for display (the mint-page counter). Once the
 * collection is LIVE, `minted` is the cap counter (nft_mint_counter.minted) — the
 * true consumption of the 10K supply. Unlike a count of the public `handles`
 * table, the counter includes the official @proofofwriting (minted from the same
 * group but deliberately kept out of that table), so the on-page "X / 10,000"
 * matches EXACTLY what the cap gate (mintCapSoldOut) enforces.
 *
 * Pre-launch the counter sits at 0 (rehearsal mints run uncounted), so fall back
 * to a live count of the `handles` table then. Take the higher of the two so a
 * mid-mint snapshot — where the counter and the handles row land a beat apart —
 * never shows a dip. `cap` comes from the counter row.
 */
export async function getMintCount(): Promise<{ minted: number; cap: number }> {
  const [handles, counter] = await Promise.all([
    supabase.from("handles").select("*", { count: "exact", head: true }),
    readCounter(),
  ]);
  const handleCount = handles.count ?? 0;
  const minted = Math.max(counter?.live ? counter.minted : 0, handleCount);
  return { minted, cap: counter?.cap ?? 10000 };
}
