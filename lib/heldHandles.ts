// =============================================================================
//  lib/heldHandles.ts
//  Enumerate which of OUR handle NFTs a wallet address currently holds.
//
//  On-chain ownership is the source of truth. We ask Chronik for the address's
//  live UTXOs, collect the token ids they carry, then intersect that set with
//  the `handles` table — our authoritative registry of handle token ids. The
//  intersection keeps us honest: an address can hold arbitrary NFTs, but only
//  the ones that are proofofwriting handles matter here.
//
//  Used by:
//    • login auto-bind (walletAuth) — pick a default display handle
//    • GET /api/account/handles     — populate the display-handle picker
//    • saveDisplayHandle            — verify the address really holds the token
//
//  BEST-EFFORT: if Chronik is unavailable these return an empty list / false,
//  so callers must treat "no held handles" as "couldn't confirm", never as a
//  reason to CLEAR an existing valid choice.
// =============================================================================

import { createServerSupabase } from "@/lib/supabase-server";
import { ChronikClient } from "chronik-client";

const CHRONIK_URLS = ["https://chronik.e.cash", "https://chronik-native.fabien.cash"];
let _chronik: ChronikClient | null = null;
const chronik = () => (_chronik ??= new ChronikClient(CHRONIK_URLS));

export type HeldHandle = {
  tokenId: string;
  handle: string;
  imageUrl: string | null;
  /** When the handle was minted — newest first is the auto-bind default. */
  createdAt: string | null;
};

/** Both stored forms of an address, so Chronik accepts it with or without the
 *  "ecash:" prefix. Chronik's address() wants the prefixed form. */
function prefixed(address: string): string {
  const a = (address ?? "").trim();
  return a.startsWith("ecash:") ? a : `ecash:${a}`;
}

/** The distinct token ids currently sitting in this address's UTXOs.
 *  Empty on any Chronik failure (caller decides how to treat that). */
async function tokenIdsAtAddress(address: string): Promise<string[]> {
  try {
    const res: any = await chronik().address(prefixed(address)).utxos();
    const utxos: any[] = res?.utxos ?? [];
    const ids = new Set<string>();
    for (const u of utxos) {
      const id = u?.token?.tokenId;
      if (id) ids.add(String(id));
    }
    return Array.from(ids);
  } catch {
    return [];
  }
}

/** Our handles that this address currently holds, newest mint first. */
export async function heldHandlesForAddress(address: string): Promise<HeldHandle[]> {
  const tokenIds = await tokenIdsAtAddress(address);
  if (tokenIds.length === 0) return [];

  const supabase = createServerSupabase();
  const { data } = await supabase
    .from("handles")
    .select("token_id, handle, image_url, created_at")
    .in("token_id", tokenIds)
    .order("created_at", { ascending: false });

  return (data ?? []).map((h: any) => ({
    tokenId: h.token_id as string,
    handle: h.handle as string,
    imageUrl: (h.image_url as string) ?? null,
    createdAt: (h.created_at as string) ?? null,
  }));
}

/** Does this address currently hold this specific token? Authoritative check
 *  used before we bind a token as an account's display handle, so a crafted
 *  save can't claim a handle the caller doesn't actually own. */
export async function addressHoldsToken(address: string, tokenId: string): Promise<boolean> {
  const tokenIds = await tokenIdsAtAddress(address);
  return tokenIds.includes(String(tokenId));
}
