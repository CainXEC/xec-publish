// =============================================================================
//  app/api/me/route.ts
//  Client-side bridge to the HttpOnly session cookie. Returns the account's
//  live identity AND the posts this account's address has unlocked — so a page
//  learns "who am I, am I an author, what have I unlocked" in one call. This
//  replaces the old reader-wallet-in-localStorage + verify-wallet-auth flow.
// =============================================================================

import { NextResponse } from "next/server";
import { adminDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { formatIdentity } from "@/lib/formatIdentity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabase = adminDb();

export async function GET() {
  const claim = await getSession();
  if (!claim) {
    return NextResponse.json({ authenticated: false });
  }

  const { data: account } = await supabase
    .from("accounts")
    .select("id, author_id, display_handle, handle_color, active_handle_token_id, account_addresses(address, is_primary)")
    .eq("id", claim.accountId)
    .maybeSingle();

  if (!account) {
    return NextResponse.json({ authenticated: false });
  }

  // The account's LIVE primary address — the cookie's address can lag after a
  // change-address swap (an in-flight rolling refresh re-signs the old claim),
  // and a login from a still-linked old wallet carries that wallet's address.
  // Identity follows the DB, matching getAuthedAccount.
  const addrRows = Array.isArray(account.account_addresses) ? account.account_addresses : [];
  const primaryAddress =
    addrRows.find((r: any) => r?.is_primary === true)?.address ?? claim.address;

  // which posts has this ACCOUNT unlocked? Unlocks are keyed by payer_address
  // and the account may have proven several wallets (e.g. after a change-address
  // swap the old wallet stays linked), so match every linked address in both
  // stored forms — same pattern as the dashboard library.
  const forms = [
    ...new Set(
      [claim.address, ...addrRows.map((r: any) => String(r?.address ?? ""))]
        .filter(Boolean)
        .map((a) => a.toLowerCase().replace(/^ecash:/, ""))
        .flatMap((bare) => [bare, `ecash:${bare}`]),
    ),
  ];

  const { data: unlockRows } = await supabase
    .from("unlocks")
    .select("post_id")
    .in("payer_address", forms);

  const unlockedPostIds = Array.from(
    new Set((unlockRows ?? []).map((r) => r.post_id).filter(Boolean)),
  );

  // is this author an admin / an AI-operated account? (nav/post page use this)
  let isAdmin = false;
  let isAi = false;
  if (account.author_id) {
    const { data: authorRow } = await supabase
      .from("authors")
      .select("is_admin, is_ai")
      .eq("id", account.author_id)
      .maybeSingle();
    isAdmin = authorRow?.is_admin === true;
    isAi = authorRow?.is_ai === true;
  }

  return NextResponse.json({
    authenticated: true,
    accountId: account.id,
    authorId: account.author_id ?? null,
    isAdmin,
    isAi,
    address: primaryAddress,
    handle: account.display_handle ?? null,
    handleColor: account.handle_color ?? null,
    identity: formatIdentity(account.display_handle, primaryAddress),
    unlockedPostIds,
    // 'challenge' (nonce-proven login) vs 'pay' (minted by a payment). The
    // Pocket wizard checks this before attempting register, which requires
    // challenge scope — same bar as change-address.
    sessionVia: claim.via ?? null,
  });
}
