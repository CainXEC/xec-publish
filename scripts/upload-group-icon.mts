// =============================================================================
//  upload-group-icon.mts
//  ONE-SHOT: register the POW Handles COLLECTION icon on the eCash token-server
//  (api.etokens.cash), keyed to the GROUP token id. Run AFTER the group genesis.
//
//  Uploads the APPROVED icon file directly (no engine re-render — avoids the
//  tsx `new URL(import.meta.url)` loader issue and guarantees we upload exactly
//  the bytes that were approved). Group parameters recovered from the prior
//  session's tested upload: NFT1_GROUP / VARIABLE (baton kept) / genesisQty 10000.
//
//  Auth mirrors lib/submitTokenIcon.ts: signature = signMsg(sha256hex(png), sk).
//  The server does NOT verify on-chain that the signer minted the token, so the
//  mint wallet signs the collection icon just as it signs each child icon.
//
//  SAFETY: dry-run by default (prints the plan, uploads NOTHING). Only POSTs with
//  --upload. Icons are IMMUTABLE (one upload per tokenId); "already exists" is
//  treated as success.
//
//    # dry run:
//    node --env-file=.env.local --import tsx scripts/upload-group-icon.mts
//    # for real:
//    node --env-file=.env.local --import tsx scripts/upload-group-icon.mts --upload
// =============================================================================

import { readFileSync } from "node:fs";
import { Wallet } from "ecash-wallet";
import { ChronikClient } from "chronik-client";
import { sha256, toHex, signMsg, fromHex } from "ecash-lib";

const CHRONIK_URLS = ["https://chronik.e.cash", "https://chronik-native.fabien.cash"];
const apiBase = () => process.env.TOKEN_ICON_API_BASE ?? "https://api.etokens.cash";

// The approved collection icon (@POW_Handles gold nib), 1024×1024 PNG.
const ICON_PATH = `${process.env.HOME}/Downloads/collection-icons/FINAL-pow-handles.png`;

// GROUP genesis metadata — must match genesis-handle-group.ts. Only surfaced in
// the moderation notification; the tokenId is what actually keys the icon.
const NAME = "POW Handles";
const TICKER = "WRITE";
const URL_STR = "https://proofofwriting.com";
const TOKEN_TYPE = "SLP_TOKEN_TYPE_NFT1_GROUP"; // collection token (type 129)
const SUPPLY_TYPE = "VARIABLE";                 // mint baton kept -> extendable
const GENESIS_QTY = "10000";
const DECIMALS = "0";

function signer(): { sk: Uint8Array; address: string } {
  const skHex = process.env.MINT_WALLET_SK?.trim();
  const mnemonic = process.env.MINT_WALLET_MNEMONIC?.trim();
  const chronik = new ChronikClient(CHRONIK_URLS);
  const wallet = skHex
    ? Wallet.fromSk(fromHex(skHex), chronik)
    : mnemonic
      ? Wallet.fromMnemonic(mnemonic, chronik)
      : null;
  if (!wallet) {
    console.error("Set MINT_WALLET_MNEMONIC or MINT_WALLET_SK (the mint wallet that holds the group token).");
    process.exit(1);
  }
  return { sk: wallet.sk, address: wallet.address };
}

async function main() {
  const groupId = process.env.GROUP_TOKEN_ID?.trim();
  if (!groupId || !/^[0-9a-f]{64}$/i.test(groupId)) {
    console.error("Set GROUP_TOKEN_ID to the 64-hex group genesis txid.");
    process.exit(1);
  }

  let png: Buffer;
  try {
    png = readFileSync(ICON_PATH);
  } catch {
    console.error(`Approved icon not found at ${ICON_PATH}`);
    process.exit(1);
  }
  const hashHex = toHex(sha256(new Uint8Array(png)));
  const s = signer();

  console.log("\n--- GROUP ICON UPLOAD PLAN -----------------------------------");
  console.log("group token id :", groupId);
  console.log("icon file      :", ICON_PATH);
  console.log("png bytes      :", png.length, `(sha256 ${hashHex.slice(0, 16)}…)`);
  console.log("token type     :", TOKEN_TYPE, "(collection)");
  console.log("supply type    :", SUPPLY_TYPE, `(genesisQty ${GENESIS_QTY}, baton kept)`);
  console.log("name / ticker  :", NAME, "/", TICKER);
  console.log("endpoint       :", `${apiBase()}/new`);
  console.log("signer address :", s.address);
  console.log("--------------------------------------------------------------");

  if (!process.argv.includes("--upload")) {
    console.log("\nDRY RUN — nothing uploaded. Re-run with --upload to register (one-shot, immutable).");
    return;
  }

  const signature = signMsg(hashHex, s.sk);
  const form = new FormData();
  form.append(
    "tokenIcon",
    new Blob([new Uint8Array(png)], { type: "image/png" }),
    `${groupId}.png`,
  );
  form.append("tokenId", groupId);
  form.append("minterAddress", s.address);
  form.append("tokenType", TOKEN_TYPE);
  form.append("supplyType", SUPPLY_TYPE);
  form.append("signature", signature);
  form.append("name", NAME);
  form.append("ticker", TICKER);
  form.append("url", URL_STR);
  form.append("decimals", DECIMALS);
  form.append("genesisQty", GENESIS_QTY);

  console.log("\nUploading collection icon…");
  const resp = await fetch(`${apiBase()}/new`, { method: "POST", body: form });
  if (resp.ok) {
    console.log("OK — collection icon accepted (moderated, serves immediately).");
    return;
  }
  const body = await resp.text().catch(() => "");
  if (/already exists/i.test(body)) {
    console.log("Already registered for this token id — nothing to do (icons are immutable).");
    return;
  }
  console.error(`Upload failed (${resp.status}): ${body.slice(0, 300)}`);
  process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
