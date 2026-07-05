// =============================================================================
//  lib/ecash/finality.ts
//  Avalanche-finality gate for value-carrying actions.
//
//  Every consequential action — minting a handle, unlocking a paywalled
//  article, publishing a paid feed post/reaction — must wait until its funding
//  transaction is AVALANCHE-FINAL before it fires. A 0-conf tx sitting in the
//  mempool can still be replaced by a conflicting double-spend; acting on it
//  lets an attacker mint an NFT / unlock an article / publish a post and then
//  claw the payment back. Chronik exposes finality as `Tx.isFinal` (true once
//  eCash's Avalanche consensus has finalized the tx — typically ~2-3s after
//  broadcast). It is monotonic: once final it stays final, and if a conflicting
//  tx wins instead, THIS txid simply never finalizes (no permanent limbo —
//  Avalanche always resolves one way or the other).
//
//  POLL-BASED, never a held websocket: the backend runs on Vercel's nodejs
//  serverless runtime, where long-lived sockets fight execution limits. Every
//  caller here already polls its own status/confirm endpoint, so each poll just
//  re-reads `isFinal`. Websockets belong on the CLIENT (for snappy labels only)
//  — the backend is always the authority and never trusts the client's word
//  that a payment is final.
// =============================================================================

import { ChronikClient } from "chronik-client";

// Standard public nodes. `isFinal` is a core Chronik field (not a plugin), so
// any node reports it — same failover pair the payment verifiers already use.
const CHRONIK_URLS = ["https://chronik.e.cash", "https://chronik-native.fabien.cash"];
let _chronik: ChronikClient | null = null;
const chronik = () => (_chronik ??= new ChronikClient(CHRONIK_URLS));

/**
 * Pure predicate: is an already-fetched Chronik tx Avalanche-final?
 *
 * Prefer this when you already hold the tx you validated (all payment verifiers
 * do). Gating on the SAME tx object you checked the outputs of means one fewer
 * network round-trip and no window between "outputs look right" and "is final".
 */
export function txIsFinal(tx: { isFinal?: boolean } | null | undefined): boolean {
  return tx?.isFinal === true;
}

/**
 * Fetch a txid and report whether it is Avalanche-final RIGHT NOW.
 *
 * For callers that only have a txid in hand. Poll-based: a single `.tx()` read,
 * no socket. A missing or unfetchable tx returns `false` (treat as "not final
 * yet"), so a caller never proceeds on a tx it could not confirm.
 */
export async function isTxFinal(txid: string): Promise<boolean> {
  try {
    const tx = await chronik().tx(txid);
    return txIsFinal(tx);
  } catch {
    return false;
  }
}

/**
 * Finer-grained finality state, for the reconcile sweep that must decide whether
 * to DELETE a provisional row. `isTxFinal` collapses "not final" and "couldn't
 * reach Chronik" into one `false`, which is unsafe for deletion — a Chronik
 * outage would look like a wave of non-final txs and wipe legitimately-final
 * rows. This distinguishes:
 *
 *   - `final`   — Avalanche-final; promote the row.
 *   - `pending` — seen on-chain but not yet final; if old enough it's stuck /
 *                 lost its double-spend race → safe to delete.
 *   - `missing` — Chronik has no such tx (evicted/replaced by a double-spend
 *                 that won) → safe to delete once past grace.
 *   - `error`   — transport/unknown failure; the caller must NOT act (leave the
 *                 row and retry next sweep) so an outage never deletes good data.
 */
export type TxFinalityState = "final" | "pending" | "missing" | "error";

export async function txFinalityState(txid: string): Promise<TxFinalityState> {
  try {
    const tx = await chronik().tx(txid);
    return tx?.isFinal === true ? "final" : "pending";
  } catch (e) {
    // chronik throws for BOTH "tx not found" and transport errors. Only a
    // definitive not-found means the tx is truly gone; treat everything else as
    // `error` (conservative — never delete on an ambiguous failure).
    const msg = String((e as { message?: string })?.message ?? e).toLowerCase();
    if (msg.includes("not found") || msg.includes("no such") || msg.includes("404")) {
      return "missing";
    }
    return "error";
  }
}
