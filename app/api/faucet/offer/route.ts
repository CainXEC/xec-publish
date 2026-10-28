// GET /api/faucet/offer — is the new-user welcome gift switched on, and for how
// much? Public (no session): the Get started modal reads it so it never promises
// a gift that's been switched off. See faucetOffer in lib/faucetConfig.ts.
//
// No rate limit: the answer is the same for everyone and cached (Data Cache 60s
// + CDN), so a flood costs nothing — and skipping it spares the Redis quota.
import { NextResponse } from "next/server";
import { faucetOffer } from "@/lib/faucetConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const offer = await faucetOffer();
  return NextResponse.json(
    { ok: true, ...offer },
    { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } },
  );
}
