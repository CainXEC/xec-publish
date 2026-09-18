// =============================================================================
//  app/api/cron/pow-payout/route.ts
//  Weekly POW reward payout, run by Vercel Cron at Monday 00:00 UTC (see
//  vercel.json) — the moment the ISO week closes. It freezes the just-completed
//  week's Contribution-Score allocation and broadcasts it from the reward wallet.
//
//  MONEY-CRITICAL. Guardrails before any send:
//   - REQUIRES the CRON_SECRET bearer (Vercel sends it on cron requests); a plain
//     public request is refused — nothing can trigger a real send but the cron.
//   - recipients must be > 0 and under a sanity cap.
//   - the total to pay must not exceed the week's distributable pool.
//   - the reward wallet must actually hold enough POW.
//  If any check fails it does NOT send, and returns the reason. The payout itself
//  is idempotent (never double-pays; a re-run only completes unpaid claims) and
//  the reward wallet holds a limited float, bounding worst-case exposure.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { ChronikClient } from "chronik-client";
import { lastCompleteWeek } from "@/lib/powRewards/isoWeek";
import { freezeWeek } from "@/lib/powRewards/freezeWeek";
import { payWeek } from "@/lib/powRewards/payWeek";
import { loadWallet, heldTokenAtoms } from "@/lib/ecash/powToken";
import { CHRONIK_URLS } from "@/lib/ecash/chronikEndpoints";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120; // freeze (Chronik scan) + a few batch sends

const POW_TOKEN_ID =
  process.env.POW_TOKEN_ID || "f36e1b3d9a2aaf74f132fef3834e9743b945a667a4204e761b85f2e7b65fd41a";
const MAX_RECIPIENTS = 1000; // sanity ceiling — a real week is a few dozen

function trusted(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  const auth = req.headers.get("authorization") || "";
  return Boolean(secret) && auth === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!trusted(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    const bounds = lastCompleteWeek();

    // 1. Freeze the just-completed week (idempotent — a re-run reuses the tally).
    const frozen = await freezeWeek(bounds);
    const totalToPay = frozen.claims.reduce((a, c) => a + c.allocationAtoms, 0);
    const recipients = frozen.claims.length;

    // 2. Guardrails — refuse to send on anything unexpected.
    if (recipients === 0) {
      return NextResponse.json({ ok: true, week: bounds.isoWeek, status: "no_recipients" });
    }
    if (recipients > MAX_RECIPIENTS) {
      return NextResponse.json(
        { ok: false, week: bounds.isoWeek, error: `recipient count ${recipients} exceeds sanity cap ${MAX_RECIPIENTS}` },
        { status: 500 },
      );
    }
    if (totalToPay > frozen.distributableAtoms) {
      return NextResponse.json(
        { ok: false, week: bounds.isoWeek, error: `total ${totalToPay} exceeds distributable ${frozen.distributableAtoms}` },
        { status: 500 },
      );
    }
    const mnemonic = process.env.POW_REWARD_WALLET_MNEMONIC;
    if (!mnemonic) {
      return NextResponse.json({ ok: false, week: bounds.isoWeek, error: "POW_REWARD_WALLET_MNEMONIC not set" }, { status: 500 });
    }
    const wallet = loadWallet({ mnemonic });
    const address = (wallet as unknown as { address: string }).address;
    const balance = await heldTokenAtoms(address, POW_TOKEN_ID);
    if (balance < BigInt(totalToPay)) {
      return NextResponse.json(
        { ok: false, week: bounds.isoWeek, error: `reward wallet underfunded: holds ${balance} POW, needs up to ${totalToPay}` },
        { status: 500 },
      );
    }
    // Cheap XEC-fuel sanity (dust + fees for the batches).
    const chronik = new ChronikClient(CHRONIK_URLS);
    const utxos: { utxos?: { token?: unknown; sats?: bigint | number | string }[] } = await chronik.address(address).utxos();
    let xecSats = 0n;
    for (const u of utxos.utxos ?? []) if (!u.token) xecSats += BigInt(u.sats ?? 0);
    if (xecSats < BigInt(recipients) * 700n) {
      return NextResponse.json(
        { ok: false, week: bounds.isoWeek, error: `reward wallet low on XEC for fees/dust (${Number(xecSats) / 100} XEC)` },
        { status: 500 },
      );
    }

    // 3. Pay (idempotent; halts safely, never double-pays).
    const res = await payWeek(bounds.isoWeek, { broadcast: true });
    return NextResponse.json({
      ok: true,
      week: bounds.isoWeek,
      freshFreeze: !frozen.alreadyFrozen,
      recipients,
      paidAtoms: res.paidAtoms,
      sent: res.sentCount,
      pending: res.pendingCount,
      txids: res.batches.map((b) => b.txid),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
