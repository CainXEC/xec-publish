// =============================================================================
//  mintPayments.ts
//  Detect the payment for a mint. This MIRRORS your article-unlock verify path:
//  same Chronik failover, same nodejs runtime, same "read the payer off the tx".
//  Matching is by op_return_raw (mintId UUID) — same tagging as the paywall —
//  with sats treated as a >= floor rather than an exact amount.
//
//  UNTAGGED FALLBACK: a buyer who copies the address and sends by hand (or pays
//  from a wallet that ignores op_return_raw) produces a plain send with NO
//  OP_RETURN, so the tag can never match. When the intent was made while logged
//  in, it records the account's proven addresses (expected_payers, same as a POW
//  mint), and a plain send from one of them is accepted for that intent. A tx
//  carrying ANY OP_RETURN (another mint's tag, a feed action, an SLP send) never
//  takes this path. One payment still funds one mint (claimPaidOrRefund).
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

/** True if the mint wallet is a SPENDER here — i.e. this is one of OUR OWN txs
 *  (a child-genesis mint, a refund, a group-UTXO split), not an incoming payment.
 *  Those return change to the mint address, so they'd otherwise look like a
 *  "payment to the mint address" to a naive scan. */
function spentByAddress(tx: any, address: string): boolean {
  for (const inp of tx.inputs ?? []) {
    if (scriptToAddress(inp.outputScript) === address) return true;
  }
  return false;
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

/** The slice of a Chronik tx the XEC mint matcher reads. */
type MintTxLike = {
  txid: string;
  inputs?: { outputScript?: string }[];
  outputs?: { outputScript?: string; sats?: bigint | number | string }[];
  isFinal?: boolean;
};

/** True if the tx has no OP_RETURN output at all — a plain send. */
function hasNoOpReturn(tx: MintTxLike): boolean {
  return !(tx.outputs ?? []).some((out) => String(out.outputScript ?? "").toLowerCase().startsWith("6a"));
}

/** Does this tx pay THIS XEC mint? Pure (no Chronik), so the rules are testable.
 *  'tagged' = its OP_RETURN carries mintId; 'untagged' = a plain send from one of
 *  the intent's expected payers (see the header). null mintId = no tag check. */
export function matchXecMintTx(
  tx: MintTxLike,
  mintAddress: string,
  mintId: string | null,
  minSats: number,
  expectedPayers: string[] = [],
): (DetectedPayment & { match: "tagged" | "untagged" }) | null {
  if (spentByAddress(tx, mintAddress)) return null; // our own mint/refund/split
  const sats = satsToAddress(tx, mintAddress);
  if (sats < minSats) return null; // amount is a floor, not exact
  const payerAddress = payerOf(tx);
  if (!payerAddress) return null;
  const found = { txid: tx.txid, payerAddress, sats, isFinal: txIsFinal(tx) };
  if (!mintId || taggedMintId(tx) === mintId) return { ...found, match: "tagged" };
  if (hasNoOpReturn(tx) && expectedPayers.includes(payerAddress)) return { ...found, match: "untagged" };
  return null;
}

/** Verify a specific txid pays the mint address at least minSats (manual "I've paid" path).
 *  If expectMintId is given, the tx's OP_RETURN tag must also match it — or, for a
 *  plain send, its payer must be one of expectedPayers. */
export async function verifyMintTxid(
  txid: string,
  mintAddress: string,
  minSats: number,
  expectMintId?: string,
  expectedPayers: string[] = [],
): Promise<DetectedPayment | null> {
  try {
    const tx = await chronik().tx(txid);
    const m = matchXecMintTx(tx, mintAddress, expectMintId ?? null, minSats, expectedPayers);
    return m ? { txid, payerAddress: m.payerAddress, sats: m.sats, isFinal: m.isFinal } : null;
  } catch {
    return null;
  }
}

/** Auto-detect: scan recent txs to the mint address for the one whose OP_RETURN
 *  is tagged with THIS mintId and which pays at least expectedSats. A tagged match
 *  wins; otherwise the newest plain send from an expected payer. */
export async function findMintPayment(
  mintAddress: string,
  mintId: string | null,
  expectedSats: number,
  sinceUnix: number,
  expectedPayers: string[] = [],
): Promise<DetectedPayment | null> {
  try {
    const page = await chronik().address(mintAddress).history(0, 25);
    let untagged: DetectedPayment | null = null;
    for (const tx of page.txs ?? []) {
      const seen = Number(tx.timeFirstSeen ?? 0);
      if (seen && seen < sinceUnix - 120) continue; // small clock skew allowance
      const m = matchXecMintTx(tx, mintAddress, mintId, expectedSats, expectedPayers);
      if (!m) continue;
      const found = { txid: m.txid, payerAddress: m.payerAddress, sats: m.sats, isFinal: m.isFinal };
      if (m.match === "tagged") return found;
      untagged ??= found;
    }
    return untagged;
  } catch {
    return null;
  }
}

// ---- POW (SLP token) mint payments ----------------------------------------
// An SLP send can't carry the mintId OP_RETURN tag, so a POW mint payment is
// matched by SENDER ∈ the account's proven addresses (recorded on the intent).

const POW_TOKEN_ID =
  process.env.POW_TOKEN_ID || "f36e1b3d9a2aaf74f132fef3834e9743b945a667a4204e761b85f2e7b65fd41a";

/** Atoms of `tokenId` delivered to `toAddress` in this tx. */
function tokenAtomsToAddress(tx: any, tokenId: string, toAddress: string): bigint {
  let atoms = 0n;
  for (const out of tx.outputs ?? []) {
    if (scriptToAddress(out.outputScript) !== toAddress) continue;
    if (out?.token?.tokenId !== tokenId) continue;
    try {
      atoms += BigInt(out.token.atoms ?? out.token.amount ?? 0);
    } catch {
      /* skip unparseable */
    }
  }
  return atoms;
}

export interface DetectedPowPayment {
  txid: string;
  payerAddress: string; // where the NFT is delivered (and, if refunded, the POW returns)
  atoms: bigint; // POW atoms received at the mint address
  isFinal: boolean;
}

/** Verify a specific txid is a POW send to the mint address of at least `minAtoms`,
 *  from one of `expectedPayers` (the intent's account addresses). */
export async function verifyPowMintTxid(
  txid: string,
  mintAddress: string,
  minAtoms: bigint,
  expectedPayers: string[],
  tokenId: string = POW_TOKEN_ID,
): Promise<DetectedPowPayment | null> {
  try {
    const tx = await chronik().tx(txid);
    const atoms = tokenAtomsToAddress(tx, tokenId, mintAddress);
    if (atoms < minAtoms) return null;
    const payerAddress = payerOf(tx);
    if (!payerAddress) return null;
    if (expectedPayers.length && !expectedPayers.includes(payerAddress)) return null;
    return { txid, payerAddress, atoms, isFinal: txIsFinal(tx) };
  } catch {
    return null;
  }
}

/** Auto-detect a POW mint payment: scan recent txs to the mint address for a POW
 *  send of ≥ minAtoms whose sender is one of expectedPayers. */
export async function findPowMintPayment(
  mintAddress: string,
  minAtoms: bigint,
  expectedPayers: string[],
  sinceUnix: number,
  tokenId: string = POW_TOKEN_ID,
): Promise<DetectedPowPayment | null> {
  try {
    const page = await chronik().address(mintAddress).history(0, 25);
    for (const tx of page.txs ?? []) {
      const seen = Number(tx.timeFirstSeen ?? 0);
      if (seen && seen < sinceUnix - 120) continue;
      if (spentByAddress(tx, mintAddress)) continue; // our own mint/refund/split
      const atoms = tokenAtomsToAddress(tx, tokenId, mintAddress);
      if (atoms < minAtoms) continue;
      const payerAddress = payerOf(tx);
      if (!payerAddress) continue;
      if (expectedPayers.length && !expectedPayers.includes(payerAddress)) continue;
      return { txid: tx.txid, payerAddress, atoms, isFinal: txIsFinal(tx) };
    }
    return null;
  } catch {
    return null;
  }
}

export interface ScannedMintPayment extends DetectedPayment {
  /** The mintId tagged in the tx's OP_RETURN, or null for a foreign/untagged tx. */
  mintId: string | null;
  /** True for a plain send with no OP_RETURN at all (the copy-address case). */
  untagged: boolean;
  /** Chronik first-seen time (unix seconds), 0 if unknown. */
  seenAt: number;
}

/** An open XEC intent the reconciler can pair an untagged payment with. */
export interface UntaggedCandidateRow {
  id: string;
  expected_sats: number | string;
  created_at: string;
  expires_at: string;
}

/** Pick the ONE intent an untagged payment belongs to, or null. Candidates are
 *  the payer's own open XEC intents (already filtered by expected_payers); this
 *  keeps those whose pay window contains the payment and whose price it covers.
 *  More than one → ambiguous (which handle did they mean?) → null, left for a
 *  person to sort out rather than guessed. */
export function pickUntaggedMintRow<T extends UntaggedCandidateRow>(
  rows: T[],
  payment: { sats: number; seenAt: number },
  skewSec = 120,
): T | null {
  const seenMs = payment.seenAt * 1000;
  const fits = rows.filter((r) => {
    if (payment.sats < Number(r.expected_sats)) return false;
    if (!payment.seenAt) return false; // no timestamp → can't place it in a window
    const from = new Date(r.created_at).getTime() - skewSec * 1000;
    const to = new Date(r.expires_at).getTime() + skewSec * 1000;
    return seenMs >= from && seenMs <= to;
  });
  return fits.length === 1 ? fits[0] : null;
}

/** Sweep recent payments to the mint address (newest first), tagging each with
 *  the mintId recovered from its OP_RETURN. The server-side reconciler uses this
 *  to find payments whose browser closed before the mint finished — it maps each
 *  back to its pending_mints row and completes the delivery. Best-effort: an
 *  empty list on any Chronik failure. */
export async function scanMintPayments(
  mintAddress: string,
  sinceUnix: number,
  limit = 50,
): Promise<ScannedMintPayment[]> {
  const out: ScannedMintPayment[] = [];
  try {
    const page = await chronik().address(mintAddress).history(0, limit);
    for (const tx of page.txs ?? []) {
      const seen = Number(tx.timeFirstSeen ?? 0);
      if (seen && seen < sinceUnix) continue;
      if (spentByAddress(tx, mintAddress)) continue; // our own mint/refund/split — not an incoming payment
      const sats = satsToAddress(tx, mintAddress);
      if (sats <= 0) continue; // not a payment TO the mint address
      const payerAddress = payerOf(tx);
      if (!payerAddress) continue;
      out.push({
        txid: tx.txid,
        payerAddress,
        sats,
        isFinal: txIsFinal(tx),
        mintId: taggedMintId(tx),
        untagged: hasNoOpReturn(tx),
        seenAt: seen,
      });
    }
  } catch {
    /* leave whatever we collected */
  }
  return out;
}
