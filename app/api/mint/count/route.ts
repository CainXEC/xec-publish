// =============================================================================
//  app/api/mint/count/route.ts
//  GET -> { ok, live, minted, cap }. Live mint progress for the mint-page
//  counter. Cheap single-row read; polled by the client, so never cached.
// =============================================================================

import { NextResponse } from "next/server";
import { getMintCount } from "@/lib/mintCap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { minted, cap } = await getMintCount();
    return NextResponse.json({ ok: true, minted, cap });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
