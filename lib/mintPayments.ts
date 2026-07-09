// =============================================================================
//  mintPayments.ts
//  Detect the payment for a mint. This MIRRORS your article-unlock verify path:
//  same Chronik failover, same nodejs runtime, same "read the payer off the tx".
//  Matching is by op_return_raw (mintId UUID) — same tagging as the paywall —
//  with sats treated as a >= floor rather than an exact amount.
// =============================================================================

import { ChronikClient } from "chronik-client";
import { encodeCashAddress } from "ecashaddrjs"; // same lib your unlock flow uses
import { decodeOpReturnToPostId } from "@/lib/opReturnEncode";
import { decodeFeedOpReturn, FEED_ACTION } from "@/lib/feedProtocol";
import { txIsFinal } from "@/lib/ecash/finality";
import { CHRONIK_URLS } from "@/lib/ecash/chronikEndpoints";

let _chronik: ChronikClient | null = null;
const chronik = () => (_chronik ??= new ChronikClient(CHRONIK_URLS));

export interface DetectedPayment {
  txid: string;
  payerAddress: string; // where the NFT will be delivered
  sats: number;         // total paid to the mint address
  isFinal: boolean;     // Avalanche-final? gate the mint on this to block double-spends
}

// P2PKH: 76a914<20>88ac  |  P2SH: a914<20>87  -> ecash address
function scriptToAddress(outputScriptHex: string): string | null {
  const s = outputScriptHex.toLowerCase();
  if (s.startsWith("76a914") && s.endsWith("88ac") && s.length === 50) {
    return encodeCashAddress("ecash", "p2pkh", s.slice(6, 46));
  }
  if (s.startsWith("a914") && s.endsWith("87") && s.length === 46) {
    return encodeCashAddress("ecash", "p2sh", s.slice(4, 44));
  }
  return null;
}

function satsToAddress(tx: any, toAddress: string): number {
  let total = 0;
  for (const out of tx.outputs ?? []) {
    if (scriptToAddress(out.outputScript) === toAddress) total += Number(out.sats ?? out.value ?? 0);
  }
  return total;
}

function payerOf(tx: any): string | null {
  const first = (tx.inputs ?? [])[0];
  return first ? scriptToAddress(first.outputScript) : null;
}

// Recover the tagged mint UUID from a tx's OP_RETURN. Accepts BOTH layouts so
// payments in flight across the deploy still verify (mirrors walletAuth.nonceOf):
// the new POWR handle envelope (LOKAD | v0 | OP_9 | mintId) and the legacy bare-UUID
// push (no LOKAD). Try the envelope FIRST — the legacy decoder would misread an
// envelope's leading 4-byte LOKAD push as the payload ("POWR"), not the UUID.
function taggedMintId(tx: any): string | null {
  for (const out of tx.outputs ?? []) {
    const script = String(out.outputScript ?? "").toLowerCase();
    if (!script.startsWith("6a")) continue;
    const powr = decodeFeedOpReturn(script);
    if (powr && powr.action === FEED_ACTION.HANDLE && powr.nonce) return powr.nonce;
    const legacy = decodeOpReturnToPostId(script);
    if (legacy) return legacy;
  }
  return null;
}

/** Verify a specific txid pays the mint address at least minSats (manual "I've paid" path).
 *  If expectMintId is given, the tx's OP_RETURN tag must also match it. */
export async function verifyMintTxid(
  txid: string,
  mintAddress: string,
  minSats: number,
  expectMintId?: string,
): Promise<DetectedPayment | null> {
  try {
    const tx = await chronik().tx(txid);
    if (expectMintId && taggedMintId(tx) !== expectMintId) return null;
    const sats = satsToAddress(tx, mintAddress);
    if (sats < minSats) return null;
    const payerAddress = payerOf(tx);
    if (!payerAddress) return null;
    return { txid, payerAddress, sats, isFinal: txIsFinal(tx) };
  } catch {
    return null;
  }
}

/** Auto-detect: scan recent txs to the mint address for the one whose OP_RETURN
 *  is tagged with THIS mintId and which pays at least expectedSats. */
export async function findMintPayment(
  mintAddress: string,
  mintId: string | null,
  expectedSats: number,
  sinceUnix: number,
): Promise<DetectedPayment | null> {
  try {
    const page = await chronik().address(mintAddress).history(0, 25);
    for (const tx of page.txs ?? []) {
      const seen = Number(tx.timeFirstSeen ?? 0);
      if (seen && seen < sinceUnix - 120) continue; // small clock skew allowance
      if (mintId && taggedMintId(tx) !== mintId) continue;      // match on the tag, not the amount
      const sats = satsToAddress(tx, mintAddress);
      if (sats < expectedSats) continue;              // amount is a floor now, not exact
      const payerAddress = payerOf(tx);
      if (payerAddress) return { txid: tx.txid, payerAddress, sats, isFinal: txIsFinal(tx) };
    }
    return null;
  } catch {
    return null;
  }
}
