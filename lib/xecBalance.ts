// =============================================================================
//  xecBalance.ts
//  Spendable XEC balance for an address, read from Chronik UTXOs. Excludes token
//  (NFT/SLP) dust outputs so the number matches what a wallet like Cashtab shows.
//  Best-effort: returns 0 on any Chronik error (never throws).
// =============================================================================

import { ChronikClient } from "chronik-client";
import { CHRONIK_URLS } from "@/lib/ecash/chronikEndpoints";

let _chronik: ChronikClient | null = null;
const chronik = () => (_chronik ??= new ChronikClient(CHRONIK_URLS));

/** Chronik's address() wants the "ecash:"-prefixed form. */
function prefixed(address: string): string {
  const a = (address ?? "").trim();
  return a.startsWith("ecash:") ? a : `ecash:${a}`;
}

/** Total spendable XEC balance (in sats) for an address; 0 on any error. */
export async function getXecBalanceSats(address: string): Promise<number> {
  if (!address) return 0;
  try {
    const res: any = await chronik().address(prefixed(address)).utxos();
    const utxos: any[] = res?.utxos ?? [];
    let sats = 0;
    for (const u of utxos) {
      if (u?.token) continue; // token dust (546 sats) — not spendable XEC
      const v = Number(u?.sats ?? u?.value ?? 0);
      if (Number.isFinite(v)) sats += v;
    }
    return sats;
  } catch {
    return 0;
  }
}
