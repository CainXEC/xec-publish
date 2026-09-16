// =============================================================================
//  lib/powRewards/payWeek.ts
//  Pay a frozen week's pending claims: batch SLP sends of POW from the reward
//  wallet, idempotent so a re-run never double-pays. See §5 of the plan.
//
//  SAFE IDEMPOTENCY (real money):
//    • Only claims with status='pending' AND send_txid IS NULL are paid.
//    • Each batch is locked pending -> 'sending' (compare-and-set) BEFORE the
//      broadcast, then set to 'sent' + send_txid AFTER it succeeds.
//    • If a broadcast throws, the claims are LEFT in 'sending' (not reverted) —
//      the tx may have hit the network. The next run REFUSES to start while any
//      claim is 'sending', so a human verifies the reward wallet's tx history and
//      resolves those rows (to 'sent' with the txid if paid, else 'pending')
//      before retrying. Fail-safe, never fail-fast into a double-pay.
//
//  With opts.broadcast=false this is a DRY report (no wallet touched, no send).
// =============================================================================

import { adminDb } from "@/lib/db";
import { loadWallet, sendTokenBatch } from "@/lib/ecash/powToken";

// The existing POW SLP token (0-decimal). See docs/pow-token-migration-plan.md §1.
const POW_TOKEN_ID = "f36e1b3d9a2aaf74f132fef3834e9743b945a667a4204e761b85f2e7b65fd41a";
const SLP_BATCH = 19; // SLP Type 1 caps a send at 19 token outputs

export interface PayResult {
  isoWeek: string;
  broadcast: boolean;
  pendingCount: number;
  sentCount: number;
  paidAtoms: number;
  batches: { txid: string; recipients: number; atoms: number }[];
}

interface ClaimRow {
  id: number;
  account_id: string;
  to_address: string;
  allocation_atoms: number;
}

export async function payWeek(isoWeek: string, opts: { broadcast: boolean }): Promise<PayResult> {
  const db = adminDb();

  const { data: epoch } = await db
    .from("pow_reward_epochs")
    .select("iso_week, status")
    .eq("iso_week", isoWeek)
    .maybeSingle();
  if (!epoch) throw new Error(`payWeek: no epoch ${isoWeek} — freeze it first`);
  if (!["tallied", "paying", "done"].includes(epoch.status)) {
    throw new Error(`payWeek: epoch ${isoWeek} status '${epoch.status}' is not payable`);
  }

  // SAFETY GATE: never proceed while claims are stuck mid-broadcast.
  const { data: stuck } = await db
    .from("pow_reward_claims")
    .select("id")
    .eq("iso_week", isoWeek)
    .eq("status", "sending");
  if (stuck && stuck.length) {
    throw new Error(
      `payWeek: ${stuck.length} claim(s) stuck in 'sending' for ${isoWeek} — a prior run crashed mid-broadcast. ` +
        `Verify the reward wallet's tx history on-chain, then set those claims to 'sent' (with the send_txid) if paid, ` +
        `or 'pending' if not, before retrying.`,
    );
  }

  const { data: pendingData } = await db
    .from("pow_reward_claims")
    .select("id, account_id, to_address, allocation_atoms")
    .eq("iso_week", isoWeek)
    .eq("status", "pending")
    .is("send_txid", null)
    .order("allocation_atoms", { ascending: false });
  const pending = (pendingData ?? []) as ClaimRow[];

  const result: PayResult = {
    isoWeek,
    broadcast: opts.broadcast,
    pendingCount: pending.length,
    sentCount: 0,
    paidAtoms: 0,
    batches: [],
  };

  if (pending.length === 0) {
    await db.from("pow_reward_epochs").update({ status: "done", updated_at: new Date().toISOString() }).eq("iso_week", isoWeek);
    return result;
  }
  if (!opts.broadcast) return result; // preview only

  const mnemonic = process.env.POW_REWARD_WALLET_MNEMONIC;
  if (!mnemonic) throw new Error("payWeek: POW_REWARD_WALLET_MNEMONIC not set");
  const wallet = loadWallet({ mnemonic });

  await db.from("pow_reward_epochs").update({ status: "paying", updated_at: new Date().toISOString() }).eq("iso_week", isoWeek);

  for (let i = 0; i < pending.length; i += SLP_BATCH) {
    const batch = pending.slice(i, i + SLP_BATCH);
    const ids = batch.map((c) => c.id);

    // Lock pending -> sending (compare-and-set); only rows still pending are taken.
    const { data: locked, error: lockErr } = await db
      .from("pow_reward_claims")
      .update({ status: "sending", updated_at: new Date().toISOString() })
      .in("id", ids)
      .eq("status", "pending")
      .is("send_txid", null)
      .select("id");
    if (lockErr) throw new Error(`payWeek lock: ${lockErr.message}`);
    const lockedIds = new Set((locked ?? []).map((r) => r.id));
    const toSend = batch.filter((c) => lockedIds.has(c.id));
    if (toSend.length === 0) continue;

    const recipients = toSend.map((c) => ({ address: c.to_address, atoms: BigInt(c.allocation_atoms) }));
    try {
      const { txid } = await sendTokenBatch(wallet, { tokenId: POW_TOKEN_ID, recipients });
      await db
        .from("pow_reward_claims")
        .update({ send_txid: txid, status: "sent", updated_at: new Date().toISOString() })
        .in("id", toSend.map((c) => c.id));
      const atoms = toSend.reduce((s, c) => s + c.allocation_atoms, 0);
      result.batches.push({ txid, recipients: toSend.length, atoms });
      result.sentCount += toSend.length;
      result.paidAtoms += atoms;
    } catch (e) {
      // Do NOT revert — the broadcast may have landed. Record the error and halt;
      // the stuck-guard above forces manual on-chain verification next run.
      const msg = e instanceof Error ? e.message : String(e);
      await db
        .from("pow_reward_claims")
        .update({ error: msg, updated_at: new Date().toISOString() })
        .in("id", toSend.map((c) => c.id));
      throw new Error(
        `payWeek: batch broadcast failed — claims left 'sending' for manual on-chain verification: ${msg}`,
      );
    }
  }

  // If nothing is left pending, the week is done.
  const { data: still } = await db
    .from("pow_reward_claims")
    .select("id")
    .eq("iso_week", isoWeek)
    .eq("status", "pending")
    .limit(1);
  if (!still || still.length === 0) {
    await db.from("pow_reward_epochs").update({ status: "done", updated_at: new Date().toISOString() }).eq("iso_week", isoWeek);
  }

  return result;
}
