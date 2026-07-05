// =============================================================================
//  submitTokenIcon.ts
//  Registers a handle NFT's card PNG as its Cashtab token icon.
//
//  Cashtab does NOT read icons from the token's genesis `url` — it serves them
//  from the eCash "token-server" (api.etokens.cash), keyed by tokenId. Until an
//  icon is uploaded there, Cashtab shows an auto-generated blockie for the id.
//  This uploads our real card so wallets render the same image as the site.
//
//  Endpoint (verified against Bitcoin-ABC/bitcoin-abc apps/token-server):
//    POST {base}/new   multipart/form-data
//    fields: tokenIcon(file .png), tokenId, minterAddress, tokenType,
//            supplyType, signature, [name, ticker, decimals, url, genesisQty]
//    auth  : signature = signMsg(sha256hex(pngBytes), sk), checked server-side
//            with verifyMsg(hash, signature, minterAddress). The server does NOT
//            verify on-chain that minterAddress minted the token, so our backend
//            mint wallet can sign every upload.
//
//  Notes / gotchas baked in from the server source:
//    - Icons are IMMUTABLE: a second upload for an existing tokenId returns an
//      error. We treat "already exists" as success (idempotent backfill).
//    - Uploads are moderated (Telegram approve/deny) but serve immediately.
//    - Max upload 2 MB; server downscales one PNG to 32/64/128/256/512.
//    - A server-to-server POST sends no Origin header, which the CORS whitelist
//      explicitly allows — so this must run from the backend, not the browser.
//
//  BEST-EFFORT: never throws. Mirrors hostHandleCard — a Cashtab-icon miss must
//  never fail a mint. Returns a small result the caller can log.
//
//  Env:
//    MINT_WALLET_SK        hex private key of the mint/signing wallet   (or)
//    MINT_WALLET_MNEMONIC  mnemonic for the same wallet
//    TOKEN_ICON_API_BASE   default "https://api.etokens.cash"
// =============================================================================

import { Wallet } from "ecash-wallet";
import { ChronikClient } from "chronik-client";
import { sha256, toHex, signMsg, fromHex } from "ecash-lib";

// Read at call time (not module load) so an override actually takes effect even
// if env is set after import — and so tests/staging can point elsewhere safely.
const apiBase = () => process.env.TOKEN_ICON_API_BASE ?? "https://api.etokens.cash";

// Handle NFTs are NFT1 children with a fixed supply of 1 — constant for every
// upload we make (see mintHandleChild.ts).
const TOKEN_TYPE = "SLP_TOKEN_TYPE_NFT1_CHILD";
const SUPPLY_TYPE = "FIXED";

// chronik-client construction requires endpoints, but signing needs no network;
// reuse the mint URLs so a wallet can be built purely to expose sk + address.
const CHRONIK_URLS = ["https://chronik.e.cash", "https://chronik-native.fabien.cash"];

export interface SubmitTokenIconResult {
  ok: boolean;
  /** true when the icon was newly accepted or already present server-side */
  registered: boolean;
  error?: string;
}

// The signing keypair is derived once from the mint wallet's env credentials.
// No sync() — we only read the static sk/address, never touch the chain here.
let _signer: { sk: Uint8Array; address: string } | null | undefined;
function signer(): { sk: Uint8Array; address: string } | null {
  if (_signer !== undefined) return _signer;
  const skHex = process.env.MINT_WALLET_SK?.trim();
  const mnemonic = process.env.MINT_WALLET_MNEMONIC?.trim();
  try {
    const chronik = new ChronikClient(CHRONIK_URLS);
    const wallet = skHex
      ? Wallet.fromSk(fromHex(skHex), chronik)
      : mnemonic
        ? Wallet.fromMnemonic(mnemonic, chronik)
        : null;
    _signer = wallet ? { sk: wallet.sk, address: wallet.address } : null;
  } catch (e) {
    console.error("[submitTokenIcon] could not load signing wallet:", e instanceof Error ? e.message : e);
    _signer = null;
  }
  if (!_signer) console.warn("[submitTokenIcon] no MINT_WALLET_SK/MINT_WALLET_MNEMONIC — skipping Cashtab icon upload");
  return _signer;
}

/**
 * Upload a handle card PNG to the eCash token-server so Cashtab shows it as the
 * NFT's icon. Best-effort: returns a result, never throws.
 *
 * @param pngBytes   the exact card PNG bytes (same buffer hostHandleCard stores)
 * @param tokenId    the NFT1-child token id (== genesis txid)
 * @param meta       optional genesis metadata, surfaced only in the moderation alert
 */
export async function submitTokenIcon(
  pngBytes: Uint8Array,
  tokenId: string,
  meta: { name?: string; ticker?: string; url?: string } = {},
): Promise<SubmitTokenIconResult> {
  const s = signer();
  if (!s) return { ok: false, registered: false, error: "no signing wallet configured" };

  try {
    const hashHex = toHex(sha256(pngBytes));
    const signature = signMsg(hashHex, s.sk);

    const form = new FormData();
    // The server reads the file from the "tokenIcon" field; name it so multer
    // keeps the .png and the PNG magic-byte check passes.
    form.append(
      "tokenIcon",
      new Blob([pngBytes as Uint8Array<ArrayBuffer>], { type: "image/png" }),
      `${tokenId}.png`,
    );
    form.append("tokenId", tokenId);
    form.append("minterAddress", s.address);
    form.append("tokenType", TOKEN_TYPE);
    form.append("supplyType", SUPPLY_TYPE);
    form.append("signature", signature);
    // Optional fields — only used to enrich the moderation notification.
    if (meta.name) form.append("name", meta.name);
    if (meta.ticker) form.append("ticker", meta.ticker);
    if (meta.url) form.append("url", meta.url);
    form.append("decimals", "0");
    form.append("genesisQty", "1");

    const resp = await fetch(`${apiBase()}/new`, { method: "POST", body: form });

    if (resp.ok) return { ok: true, registered: true };

    // The server returns 500 with this message when an icon already exists for
    // the tokenId. Icons are immutable, so that's a no-op success for us — the
    // image is already live. Any other status is a real failure.
    const body = await resp.text().catch(() => "");
    if (/already exists/i.test(body)) {
      return { ok: true, registered: true };
    }
    console.error(`[submitTokenIcon] upload failed (${resp.status}) for ${tokenId}: ${body.slice(0, 200)}`);
    return { ok: false, registered: false, error: `${resp.status}: ${body.slice(0, 200)}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[submitTokenIcon] failed:", msg);
    return { ok: false, registered: false, error: msg };
  }
}
