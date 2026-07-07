// =============================================================================
//  app/api/account/handles/route.ts
//  Session-authorized listing of the handles the logged-in wallet CURRENTLY
//  holds on-chain, plus which one is bound as the display handle. Powers the
//  display-handle picker (a wallet can hold several handles but shows one).
//
//  On-chain holdings are the source of truth (heldHandlesForAddress), so this
//  reflects reality even for handles that were bought/transferred and never
//  minted through this account.
// =============================================================================

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSession } from "@/lib/session";
import { heldHandlesForAddress } from "@/lib/heldHandles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabase = createClient(
  (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL)!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

export async function GET() {
  const claim = await getSession();
  if (!claim) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  const { data: account } = await supabase
    .from("accounts")
    .select("id, active_handle_token_id")
    .eq("id", claim.accountId)
    .maybeSingle();
  if (!account) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  const held = await heldHandlesForAddress(claim.address);

  return NextResponse.json({
    authenticated: true,
    address: claim.address,
    activeTokenId: account.active_handle_token_id ?? null,
    handles: held.map((h) => ({
      tokenId: h.tokenId,
      handle: h.handle,
      imageUrl: h.imageUrl,
    })),
  });
}
