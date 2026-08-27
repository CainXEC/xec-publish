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

import { unstable_cache } from "next/cache";
import { adminDb } from "@/lib/db";
import { ChronikClient } from "chronik-client";
import { CHRONIK_URLS } from "@/lib/ecash/chronikEndpoints";
import { chronikBudget } from "@/lib/ecash/chronikBudget";

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

/** Our handles that this address currently holds, newest mint first.
 *  Display path (profile carousel) — budgeted: a hung Chronik endpoint yields
 *  an empty strip instead of a 30s stall. addressHoldsToken below stays
 *  UNBUDGETED: it authorizes handle binding, and security checks wait. */
// Max token ids per `.in(...)` so the PostgREST request URL stays small. A whale
// wallet can hold 1000+ tokens; a single .in() over all of them builds a URL big
// enough to FAIL (the request errors and returns no rows — the "holds no handles"
// bug on a large holder). Chunk + merge instead. 64-hex ids × 50 ≈ a ~4KB URL.
const HANDLE_IN_CHUNK = 50;

export async function heldHandlesForAddress(address: string): Promise<HeldHandle[]> {
  const tokenIds = await chronikBudget(tokenIdsAtAddress(address), 2500, [] as string[]);
  if (tokenIds.length === 0) return [];

  const supabase = adminDb();
  const chunks: string[][] = [];
  for (let i = 0; i < tokenIds.length; i += HANDLE_IN_CHUNK) {
    chunks.push(tokenIds.slice(i, i + HANDLE_IN_CHUNK));
  }
  const rows = (
    await Promise.all(
      chunks.map((ids) =>
        supabase
          .from("handles")
          .select("token_id, handle, image_url, created_at")
          .in("token_id", ids)
          .then((r) => r.data ?? []),
      ),
    )
  ).flat();

  return rows
    .map((h: any) => ({
      tokenId: h.token_id as string,
      handle: h.handle as string,
      imageUrl: (h.image_url as string) ?? null,
      createdAt: (h.created_at as string) ?? null,
    }))
    // Newest mint first (done in memory now that results are merged from chunks).
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

// How long the profile carousel may serve a cached held-handles enumeration
// before re-checking on-chain. Matches the 5-minute display-holder cache in
// resolveProfile — a cosmetic strip; the AUTHORITATIVE byline binding never
// reads this.
const HELD_HANDLES_DISPLAY_CACHE_S = 300;

/** heldHandlesForAddress for the PROFILE CAROUSEL (display only), cached briefly
 *  in the Next Data Cache so the handle strip pops in fast on repeat visits
 *  instead of paying the ~2.5s Chronik enumeration every time — the single
 *  longest streamed boundary left on a profile. Keyed by address.
 *
 *  An EMPTY result is treated as a miss/outage and NOT cached (we throw, and
 *  errors aren't cached), so a Chronik hiccup can't blank a real holder's strip
 *  for the window — the next visit retries live. A genuinely handle-less address
 *  simply isn't sped up (same ~2.5s it pays today), which is fine: profiles are
 *  reached via /@handle, so the common case holds ≥1 handle and gets cached.
 *
 *  The authoritative paths — login auto-bind, the display-handle picker, and
 *  addressHoldsToken's binding check — keep calling the UNcached functions, so
 *  a freshly minted/received handle is reflected there immediately. */
export async function cachedHeldHandlesForDisplay(address: string): Promise<HeldHandle[]> {
  const addr = (address ?? "").trim();
  if (!addr) return [];
  try {
    return await unstable_cache(
      async () => {
        const held = await heldHandlesForAddress(addr);
        if (held.length === 0) throw new Error("held-handles-unavailable");
        return held;
      },
      ["held-handles-display", addr],
      { revalidate: HELD_HANDLES_DISPLAY_CACHE_S },
    )();
  } catch {
    return [];
  }
}

/** Does this address currently hold this specific token? Authoritative check
 *  used before we bind a token as an account's display handle, so a crafted
 *  save can't claim a handle the caller doesn't actually own. */
export async function addressHoldsToken(address: string, tokenId: string): Promise<boolean> {
  const tokenIds = await tokenIdsAtAddress(address);
  return tokenIds.includes(String(tokenId));
}
