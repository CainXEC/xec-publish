// =============================================================================
//  lib/faucet.ts — the new-user welcome faucet (2,500 XEC + 10 POW).
//
//  Flow: a newcomer makes a Cashtab wallet and claims Cashtab's free 42 XEC
//  (captcha-gated by Cashtab), logs in here with it (6 XEC challenge), then taps
//  Claim → the PATRON wallet sends them XEC (to act on the site) + POW (exactly
//  one base-tier handle mint, lib/handlePricing.ts) in ONE atomic tx.
//
//  Anti-farming, all enforced here + in sql/faucet_claims.sql:
//    • Cashtab-origin: the claimant's wallet must have received a plain (non-
//      token) payment of ≥ sourceMinSats from Cashtab's faucet address. A self-
//      funded wallet fails, so every claim goes through Cashtab's captcha. (That
//      address also sends 5.46-XEC token dust — the size + no-token filter
//      matches only the 42 XEC new-wallet faucet.)
//    • Brand-new only (never tipped / posted / reacted — lib/onboarding.js) and
//      never house/founder accounts.
//    • One claim per account, per alt-cluster, per receiving address.
//    • A UTC-day cap on total XEC + POW, reserved atomically (advisory lock).
//    • The route adds an IP rate limit.
//
//  Config is DB-driven (pow_reward_config id='faucet', live, no deploy) with
//  DEFAULT_FAUCET_CONFIG as the fallback. The sender key is the Vercel env
//  PATRON_WALLET_MNEMONIC; the loaded wallet must equal FAUCET_WALLET_ADDRESS
//  (default: the patron wallet) or nothing is sent.
//
//  ⚠ If anything else ever spends from this wallet concurrently (the ai-satoshi
//  daily reward did, until it was retired 2026-09-27), the two can race on UTXOs;
//  the loser is rejected by the node → recorded 'failed' (slot freed) and the
//  user can simply retry.
// =============================================================================

import { ChronikClient } from "chronik-client";
import { Script, SLP_TOKEN_TYPE_FUNGIBLE } from "ecash-lib";
import { getOutputScriptFromAddress } from "ecashaddrjs";
import { adminDb } from "@/lib/db";
import { CHRONIK_URLS } from "@/lib/ecash/chronikEndpoints";
import { loadWallet } from "@/lib/ecash/powToken";
import { buildResolver } from "@/lib/powRewards/accounts";
import { isBrandNewUnfunded } from "@/lib/onboarding";

// The POW SLP token (0-decimal → atoms == whole tokens).
export const POW_TOKEN_ID = "f36e1b3d9a2aaf74f132fef3834e9743b945a667a4204e761b85f2e7b65fd41a";
const PATRON_ADDRESS = "ecash:qzxr8qtmaycth603fqhg780cymu0sm0ysuj05ephls";
const DUST = 546n;

export interface FaucetConfig {
  enabled: boolean;
  xecPerClaim: number; // whole XEC
  powPerClaim: number; // whole POW
  dailyXecCap: number; // whole XEC per UTC day
  dailyPowCap: number; // whole POW per UTC day
  sourceAddress: string; // Cashtab's new-wallet faucet
  sourceMinSats: number; // min plain payment from it that counts (4200 = 42 XEC)
}

export const DEFAULT_FAUCET_CONFIG: FaucetConfig = {
  enabled: true,
  xecPerClaim: 2500, // room to post/react/unlock AND fund the Pocket's 1,000 XEC preset
  powPerClaim: 10, // == the base-tier handle price in POW
  dailyXecCap: 25000, // 10 claims/day at 2,500
  dailyPowCap: 100,
  sourceAddress: "ecash:qzppgpav9xfls6zzyuqy7syxpqhnlqqa5u68m4qw6l",
  sourceMinSats: 4200,
};

export async function loadFaucetConfig(): Promise<FaucetConfig> {
  try {
    const { data } = await adminDb().from("pow_reward_config").select("config").eq("id", "faucet").maybeSingle();
    return { ...DEFAULT_FAUCET_CONFIG, ...((data?.config ?? {}) as Partial<FaucetConfig>) };
  } catch {
    return DEFAULT_FAUCET_CONFIG;
  }
}

/** Next 00:00 UTC — when the daily cap resets. */
export function nextResetIso(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
}

function utcDayStartIso(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

export type FaucetState =
  | "signedout" // not logged in
  | "disabled" // switched off / sender not configured
  | "not_new" // an established account — the gift is for newcomers
  | "ineligible" // wallet wasn't funded by Cashtab's new-wallet faucet (or a house account)
  | "claimed" // already received it
  | "capped" // today's budget is used up — resets 00:00 UTC
  | "eligible" // can claim now
  | "sent" // just sent (claim response)
  | "unknown"; // send outcome ambiguous — held for manual check

export interface FaucetStatus {
  state: FaucetState;
  xec: number;
  pow: number;
  resetsAt: string;
  txid?: string | null;
}

function walletConfigured(): boolean {
  return !!process.env.PATRON_WALLET_MNEMONIC?.trim();
}

async function accountAddresses(accountId: string): Promise<{ address: string; is_primary: boolean }[]> {
  const { data } = await adminDb().from("account_addresses").select("address, is_primary").eq("account_id", accountId);
  return (data ?? []) as { address: string; is_primary: boolean }[];
}

// Just the Chronik fields the origin check reads.
interface ChronikIo { outputScript?: string; sats?: bigint | number; value?: number; token?: unknown }
interface ChronikHistory { txs?: { inputs?: ChronikIo[]; outputs?: ChronikIo[] }[] }
interface BroadcastResp { success?: boolean; broadcasted?: string[]; txid?: string }

const scriptOf = (addr: string) => {
  try {
    return getOutputScriptFromAddress(addr.startsWith("ecash:") ? addr : `ecash:${addr}`).toLowerCase();
  } catch {
    return null;
  }
};

/** Did any of these addresses receive a plain ≥ sourceMinSats payment FROM the
 *  Cashtab faucet address? (A new wallet has few txs; we scan up to 200.) */
export async function fundedByCashtabFaucet(addresses: string[], cfg: FaucetConfig): Promise<boolean> {
  const sourceScript = scriptOf(cfg.sourceAddress);
  if (!sourceScript) return false;
  const chronik = new ChronikClient(CHRONIK_URLS);
  for (const addr of addresses) {
    const mine = scriptOf(addr);
    if (!mine) continue;
    for (let page = 0; page < 4; page++) {
      let res: ChronikHistory;
      try {
        res = (await chronik.address(addr.startsWith("ecash:") ? addr : `ecash:${addr}`).history(page, 50)) as ChronikHistory;
      } catch {
        break;
      }
      for (const tx of res?.txs ?? []) {
        const fromSource = (tx.inputs ?? []).some((i) => String(i?.outputScript ?? "").toLowerCase() === sourceScript);
        if (!fromSource) continue;
        const paidMe = (tx.outputs ?? []).some(
          (o) =>
            String(o?.outputScript ?? "").toLowerCase() === mine &&
            !o?.token &&
            Number(o?.sats ?? o?.value ?? 0) >= cfg.sourceMinSats,
        );
        if (paidMe) return true;
      }
      if ((res?.txs ?? []).length < 50) break; // last page
    }
  }
  return false;
}

async function liveClaimFor(accountId: string, clusterId: string, addresses: string[]) {
  const db = adminDb();
  const ors = [`account_id.eq.${accountId}`, `cluster_id.eq.${clusterId}`];
  const { data } = await db
    .from("faucet_claims")
    .select("id, status, txid")
    .neq("status", "failed")
    .or(ors.join(","))
    .limit(1);
  if (data?.length) return data[0];
  if (addresses.length) {
    const { data: byAddr } = await db
      .from("faucet_claims")
      .select("id, status, txid")
      .neq("status", "failed")
      .in("to_address", addresses)
      .limit(1);
    if (byAddr?.length) return byAddr[0];
  }
  return null;
}

async function capReached(cfg: FaucetConfig): Promise<boolean> {
  const { data } = await adminDb()
    .from("faucet_claims")
    .select("xec_sats, pow_atoms")
    .neq("status", "failed")
    .gte("created_at", utcDayStartIso());
  let xec = 0;
  let pow = 0;
  for (const r of data ?? []) {
    xec += Number(r.xec_sats);
    pow += Number(r.pow_atoms);
  }
  return xec + cfg.xecPerClaim * 100 > cfg.dailyXecCap * 100 || pow + cfg.powPerClaim > cfg.dailyPowCap;
}

/** Where this account stands with the faucet. Cheap DB checks run first; the
 *  Chronik origin check only runs for a brand-new, not-yet-claimed account. */
export async function faucetStatus(acct: { accountId: string } | null): Promise<FaucetStatus> {
  const cfg = await loadFaucetConfig();
  const base = { xec: cfg.xecPerClaim, pow: cfg.powPerClaim, resetsAt: nextResetIso() };
  if (!acct?.accountId) return { ...base, state: "signedout" };
  if (!cfg.enabled || !walletConfigured()) return { ...base, state: "disabled" };

  const R = await buildResolver([acct.accountId]);
  if (R.rewardExcluded(acct.accountId)) return { ...base, state: "ineligible" }; // house / founder
  const clusterId = R.eff(acct.accountId);
  const addrs = (await accountAddresses(acct.accountId)).map((a) => a.address);

  const prior = await liveClaimFor(acct.accountId, clusterId, addrs);
  if (prior) return { ...base, state: prior.status === "unknown" ? "unknown" : "claimed", txid: prior.txid ?? null };

  if (!(await isBrandNewUnfunded(acct.accountId))) return { ...base, state: "not_new" };
  if (!(await fundedByCashtabFaucet(addrs, cfg))) return { ...base, state: "ineligible" };
  if (await capReached(cfg)) return { ...base, state: "capped" };
  return { ...base, state: "eligible" };
}

/** Build (NOT broadcast) the one atomic gift tx: POW token output + plain XEC
 *  output to the same address. ecash-wallet fills the SLP SEND amounts (a 0
 *  placeholder for the XEC output) and adds XEC + token change back to the
 *  sender. Every token output declares its 546-sat dust (ecash-wallet gotcha). */
export async function buildGiftTx(
  wallet: ReturnType<typeof loadWallet>,
  toAddress: string,
  xecSats: bigint,
  powAtoms: bigint,
): Promise<{ broadcast: () => Promise<unknown> }> {
  await wallet.sync();
  const to = Script.fromAddress(toAddress);
  const action = {
    outputs: [
      { sats: 0n }, // blank OP_RETURN slot for the SLP SEND
      { sats: DUST, script: to, tokenId: POW_TOKEN_ID, atoms: powAtoms, isMintBaton: false },
      { sats: xecSats, script: to }, // plain XEC
    ],
    tokenActions: [{ type: "SEND", tokenId: POW_TOKEN_ID, tokenType: SLP_TOKEN_TYPE_FUNGIBLE }],
  };
  return wallet.action(action as unknown as Parameters<typeof wallet.action>[0]).build();
}

/** Claim: re-check eligibility, atomically reserve a slot, send XEC + POW in one tx. */
export async function claimFaucet(
  acct: { accountId: string },
  ip: string | null,
): Promise<FaucetStatus & { ok: boolean; error?: string }> {
  const status = await faucetStatus(acct);
  if (status.state !== "eligible") return { ...status, ok: false };

  const cfg = await loadFaucetConfig();
  const db = adminDb();
  const R = await buildResolver([acct.accountId]);
  const clusterId = R.eff(acct.accountId);
  const addrRows = await accountAddresses(acct.accountId);
  const toAddress = addrRows.find((a) => a.is_primary)?.address ?? addrRows[0]?.address;
  if (!toAddress) return { ...status, ok: false, state: "ineligible", error: "no address on account" };

  const xecSats = BigInt(Math.round(cfg.xecPerClaim * 100));
  const powAtoms = BigInt(Math.round(cfg.powPerClaim));

  const { data: slot, error: slotErr } = await db.rpc("faucet_reserve_slot", {
    p_account_id: acct.accountId,
    p_cluster_id: clusterId,
    p_to_address: toAddress,
    p_xec_sats: Number(xecSats),
    p_pow_atoms: Number(powAtoms),
    p_daily_xec_cap_sats: Math.round(cfg.dailyXecCap * 100),
    p_daily_pow_cap_atoms: Math.round(cfg.dailyPowCap),
    p_ip: ip,
  });
  if (slotErr) return { ...status, ok: false, state: "disabled", error: slotErr.message };
  const s = slot as { ok: boolean; id?: number; reason?: string };
  if (!s?.ok) return { ...status, ok: false, state: s?.reason === "capped" ? "capped" : "claimed" };
  const claimId = s.id!;

  const mark = (patch: Record<string, unknown>) =>
    db.from("faucet_claims").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", claimId);

  // ---- Build (a failure here means nothing was sent → 'failed', retryable) ----
  let built: { broadcast: () => Promise<unknown> };
  try {
    const wallet = loadWallet({ mnemonic: process.env.PATRON_WALLET_MNEMONIC?.trim() });
    const expected = (process.env.FAUCET_WALLET_ADDRESS?.trim() || PATRON_ADDRESS).toLowerCase();
    if (wallet.address.toLowerCase() !== expected) {
      throw new Error(`faucet wallet is ${wallet.address}, expected ${expected}`);
    }
    built = await buildGiftTx(wallet, toAddress, xecSats, powAtoms);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await mark({ status: "failed", error: `build: ${msg}`.slice(0, 500) });
    console.error("[faucet] build failed", msg);
    return { ...status, ok: false, state: "eligible", error: "The faucet couldn't send right now — please try again in a minute." };
  }

  // ---- Broadcast ----
  try {
    const resp = (await built.broadcast()) as BroadcastResp | null;
    if (resp && resp.success === false) {
      await mark({ status: "failed", error: `rejected: ${JSON.stringify(resp)}`.slice(0, 500) });
      return { ...status, ok: false, state: "eligible", error: "The faucet couldn't send right now — please try again in a minute." };
    }
    const txids: string[] = Array.isArray(resp?.broadcasted) ? resp.broadcasted : resp?.txid ? [resp.txid] : [];
    const txid = txids[txids.length - 1] ?? null;
    await mark({ status: "sent", txid });
    return { ...status, ok: true, state: "sent", txid };
  } catch (e) {
    // Ambiguous: the tx may have reached the network. Never risk a double-pay —
    // hold the slot as 'unknown' for a manual check.
    const msg = e instanceof Error ? e.message : String(e);
    await mark({ status: "unknown", error: `broadcast: ${msg}`.slice(0, 500) });
    console.error("[faucet] broadcast ambiguous", claimId, msg);
    return { ...status, ok: false, state: "unknown", error: "Your gift is being verified — it should arrive shortly." };
  }
}
