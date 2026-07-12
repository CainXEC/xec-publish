// =============================================================================
//  app/api/handles/provenance/[tokenId]/route.ts
//  Public provenance for one minted handle NFT, for the marketplace gallery's
//  hover card: mint date, on-chain transfer count, and the current holder.
//
//  Chain facts come straight from Chronik (same best-effort pattern as
//  resolveProfile.ts): token history size -> transfer count, the NFT's single
//  live UTXO -> holder. A P2SH holder means the NFT sits in the Agora escrow
//  covenant (it's listed for sale) rather than in a wallet. Chronik being down
//  degrades fields to null — never a 5xx — so the hover card can still show
//  the mint date.
//
//  Transfer count = total token txs minus the genesis. Listing/cancelling on
//  Agora moves the NFT in and out of escrow, so those moves count too — that's
//  honest on-chain history, not an error.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ChronikClient } from "chronik-client";
import { encodeCashAddress } from "ecashaddrjs";
import { CHRONIK_URLS } from "@/lib/ecash/chronikEndpoints";
import { chronikBudget } from "@/lib/ecash/chronikBudget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabase = createClient(
  (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL)!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

let _chronik: ChronikClient | null = null;
const chronik = () => (_chronik ??= new ChronikClient(CHRONIK_URLS));

// Same decoding as resolveProfile.ts: P2PKH -> wallet address, P2SH -> a
// script (for handle NFTs, in practice the Agora escrow covenant).
function scriptToAddress(outputScriptHex: string): { address: string; escrow: boolean } | null {
  const s = String(outputScriptHex).toLowerCase();
  if (s.startsWith("76a914") && s.endsWith("88ac") && s.length === 50) {
    return { address: encodeCashAddress("ecash", "p2pkh", s.slice(6, 46)), escrow: false };
  }
  if (s.startsWith("a914") && s.endsWith("87") && s.length === 46) {
    return { address: encodeCashAddress("ecash", "p2sh", s.slice(4, 44)), escrow: true };
  }
  return null;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ tokenId: string }> }) {
  const { tokenId } = await params;
  if (!/^[0-9a-f]{64}$/i.test(tokenId)) {
    return NextResponse.json({ ok: false, error: "bad token id" }, { status: 400 });
  }

  const { data: h } = await supabase
    .from("handles")
    .select("handle, created_at")
    .eq("token_id", tokenId.toLowerCase())
    .maybeSingle();
  if (!h) {
    return NextResponse.json({ ok: false, error: "unknown handle" }, { status: 404 });
  }

  // ---- on-chain move count (genesis excluded) ----
  // Budgeted: a hover card degrades field-by-field; it never stalls.
  let transferCount: number | null = null;
  try {
    const page = await chronikBudget(chronik().tokenId(tokenId).history(0, 1), 2500, null);
    if (page) transferCount = Math.max(0, (page.numTxs ?? 0) - 1);
  } catch {
    /* Chronik down — leave null */
  }

  // ---- current holder: the NFT's single live UTXO ----
  let holderAddress: string | null = null;
  let escrow = false;
  try {
    const res = await chronikBudget(chronik().tokenId(tokenId).utxos(), 2500, null);
    for (const u of res?.utxos ?? []) {
      const script = (u as { script?: string; outputScript?: string }).script
        ?? (u as { outputScript?: string }).outputScript;
      if (!script) continue;
      const decoded = scriptToAddress(script);
      if (decoded) {
        holderAddress = decoded.address;
        escrow = decoded.escrow;
        break;
      }
    }
  } catch {
    /* Chronik down — leave null */
  }

  // ---- the holder's display identity, if that wallet has an account ----
  let holderDisplay: string | null = null;
  if (holderAddress && !escrow) {
    const bare = holderAddress.replace(/^ecash:/, "");
    const { data: links } = await supabase
      .from("account_addresses")
      .select("account_id")
      .in("address", [bare, `ecash:${bare}`])
      .limit(1);
    const accountId = links?.[0]?.account_id;
    if (accountId) {
      const { data: account } = await supabase
        .from("accounts")
        .select("display_handle")
        .eq("id", accountId)
        .maybeSingle();
      if (account?.display_handle) holderDisplay = `@${account.display_handle}`;
    }
  }

  return NextResponse.json(
    {
      ok: true,
      tokenId: tokenId.toLowerCase(),
      handle: h.handle,
      mintedAt: h.created_at,
      transferCount,
      holder: holderAddress ? { address: holderAddress, escrow, display: holderDisplay } : null,
    },
    // Provenance moves rarely; let the CDN absorb hover bursts.
    { headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=600" } }
  );
}
