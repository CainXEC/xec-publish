// =============================================================================
//  app/api/me/route.ts
//  Client-side bridge to the HttpOnly session cookie. Returns the account's
//  live identity AND the posts this account's address has unlocked — so a page
//  learns "who am I, am I an author, what have I unlocked" in one call. This
//  replaces the old reader-wallet-in-localStorage + verify-wallet-auth flow.
// =============================================================================

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSession } from "@/lib/session";

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
    return NextResponse.json({ authenticated: false });
  }

  const { data: account } = await supabase
    .from("accounts")
    .select("id, author_id, display_handle, handle_color, active_handle_token_id")
    .eq("id", claim.accountId)
    .maybeSingle();

  if (!account) {
    return NextResponse.json({ authenticated: false });
  }

  // which posts has this address unlocked? (both stored forms, prefix-agnostic)
  const forms = claim.address.startsWith("ecash:")
    ? [claim.address, claim.address.slice("ecash:".length)]
    : [claim.address, `ecash:${claim.address}`];

  const { data: unlockRows } = await supabase
    .from("unlocks")
    .select("post_id")
    .in("payer_address", forms);

  const unlockedPostIds = Array.from(
    new Set((unlockRows ?? []).map((r) => r.post_id).filter(Boolean)),
  );

  // is this author an admin? (nav/post page use this)
  let isAdmin = false;
  if (account.author_id) {
    const { data: authorRow } = await supabase
      .from("authors")
      .select("is_admin")
      .eq("id", account.author_id)
      .maybeSingle();
    isAdmin = authorRow?.is_admin === true;
  }

  return NextResponse.json({
    authenticated: true,
    accountId: account.id,
    authorId: account.author_id ?? null,
    isAdmin,
    address: claim.address,
    handle: account.display_handle ?? null,
    handleColor: account.handle_color ?? null,
    identity: account.display_handle ? `@${account.display_handle}` : claim.address,
    unlockedPostIds,
  });
}
