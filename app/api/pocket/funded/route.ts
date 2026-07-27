// =============================================================================
//  app/api/pocket/funded/route.ts
//  POST {txid} -> record the funding tx that carried the on-chain DELEGATE
//  commitment (OP_12: the funder's wallet endorsing the pocket pubkey).
//
//  Best-effort provenance, NOT a money gate: the pocket balance is whatever
//  the chain says, with or without this record. Loose verification — the tx
//  must pay the account's registered pocket address and carry a DELEGATE of
//  the registered pubkey; first matching txid sticks.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/db";
import { ChronikClient } from "chronik-client";
import { decodeCashAddress } from "ecashaddrjs";
import { getSession } from "@/lib/session";
import { decodeFeedOpReturn, FEED_ACTION } from "@/lib/feedProtocol";
import { rateLimit, getClientIp } from "@/lib/rateLimit";
import { CHRONIK_URLS } from "@/lib/ecash/chronikEndpoints";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabase = adminDb();

let _chronik: ChronikClient | null = null;
const chronik = () => (_chronik ??= new ChronikClient(CHRONIK_URLS));

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  if (!(await rateLimit(ip, 20, 60, "pocket-funded"))) {
    return NextResponse.json({ ok: false, error: "Too many requests" }, { status: 429 });
  }

  const claim = await getSession();
  if (!claim) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body" }, { status: 400 });
  }
  const txid = typeof body?.txid === "string" && /^[0-9a-f]{64}$/i.test(body.txid.trim())
    ? body.txid.trim().toLowerCase()
    : null;
  if (!txid) {
    return NextResponse.json({ ok: false, error: "Invalid txid" }, { status: 400 });
  }

  const { data: pocket } = await supabase
    .from("pocket_wallets")
    .select("address, pubkey, delegate_txid")
    .eq("account_id", claim.accountId)
    .maybeSingle();
  if (!pocket) {
    return NextResponse.json({ ok: false, error: "No pocket registered" }, { status: 404 });
  }
  if (pocket.delegate_txid) {
    return NextResponse.json({ ok: true, recorded: false, delegateTxid: pocket.delegate_txid });
  }

  // Loose verification: pays the pocket + carries DELEGATE(pubkey). Failures
  // return 200 {recorded:false} — provenance is a nicety, never a blocker.
  try {
    const tx = await chronik().tx(txid);
    const { hash } = decodeCashAddress(pocket.address);
    const pocketScript = `76a914${String(hash).toLowerCase()}88ac`;

    const outputs: Array<{ outputScript?: string; sats?: bigint | number }> = tx.outputs ?? [];
    const paysPocket = outputs.some(
      (o) => String(o.outputScript ?? "").toLowerCase() === pocketScript && Number(o.sats ?? 0) > 0,
    );
    const hasDelegate = outputs.some((o) => {
      const decoded = decodeFeedOpReturn(String(o.outputScript ?? ""));
      return decoded?.action === FEED_ACTION.DELEGATE && decoded.pubkey === pocket.pubkey.toLowerCase();
    });

    if (!paysPocket || !hasDelegate) {
      return NextResponse.json({ ok: true, recorded: false });
    }
  } catch {
    return NextResponse.json({ ok: true, recorded: false });
  }

  await supabase
    .from("pocket_wallets")
    .update({ delegate_txid: txid, updated_at: new Date().toISOString() })
    .eq("account_id", claim.accountId)
    .is("delegate_txid", null);

  return NextResponse.json({ ok: true, recorded: true, delegateTxid: txid });
}
