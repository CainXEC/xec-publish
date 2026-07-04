// =============================================================================
//  app/api/auth/logout/route.ts
//  POST -> clear the wallet session cookie AND expire every per-post unlock
//  cookie, so logout re-locks paid content on this device. (The unlock rows in
//  the DB are untouched — logging back in re-grants access via /api/me's
//  unlockedPostIds, so the reader never re-pays.)
// =============================================================================

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { clearSessionCookie } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  await clearSessionCookie();

  // Expire all `unlock_<postId>` cookies so SSR entitlement re-locks content.
  const store = await cookies();
  for (const cookie of store.getAll()) {
    if (cookie.name.startsWith("unlock_")) {
      store.set(cookie.name, "", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 0,
      });
    }
  }

  return NextResponse.json({ ok: true });
}
