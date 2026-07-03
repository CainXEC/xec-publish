// =============================================================================
//  mint-one-handle.ts
//  Test-mint a SINGLE handle NFT end-to-end. Dry-run by default; only broadcasts
//  with BOTH  --broadcast  AND  CONFIRM=MINT.
//
//    # dry run:
//    MINT_WALLET_MNEMONIC="..." GROUP_TOKEN_ID="..." \
//      npx tsx mint-one-handle.ts --handle SimonCain --to ecash:qq...
//
//    # for real:
//    MINT_WALLET_MNEMONIC="..." GROUP_TOKEN_ID="..." CONFIRM=MINT \
//      npx tsx mint-one-handle.ts --handle SimonCain --to ecash:qq... --broadcast
// =============================================================================

import { loadMintWallet, mintHandleChild } from "../lib/mintHandleChild";
import { validateHandleSyntax, displayHandle } from "../lib/handleSkeleton";

const CHRONIK_URLS = ["https://chronik.e.cash", "https://chronik-native.fabien.cash"];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const handle = arg("handle");
  const to = arg("to");
  const groupTokenId = process.env.GROUP_TOKEN_ID;
  const mnemonic = process.env.MINT_WALLET_MNEMONIC;
  const skHex = process.env.MINT_WALLET_SK;

  if (!handle || !to) { console.error("Need --handle <name> and --to <ecash:address>"); process.exit(1); }
  if (!groupTokenId) { console.error("Set GROUP_TOKEN_ID (from genesis)."); process.exit(1); }
  if (!mnemonic && !skHex) { console.error("Set MINT_WALLET_MNEMONIC or MINT_WALLET_SK."); process.exit(1); }

  const syntaxErr = validateHandleSyntax(handle);
  if (syntaxErr) { console.error("Invalid handle:", syntaxErr); process.exit(1); }

  const wallet = loadMintWallet(CHRONIK_URLS, { mnemonic, skHex });
  await wallet.sync();

  console.log("Mint wallet   :", wallet.address);
  console.log("Balance       :", (Number(wallet.balanceSats) / 100).toLocaleString(), "XEC");
  console.log("\n--- MINT PLAN ------------------------------------------------");
  console.log("handle        :", displayHandle(handle));
  console.log("deliver to    :", to);
  console.log("group token   :", groupTokenId);
  console.log("url           : https://proofofwriting.com/@" + displayHandle(handle));
  console.log("--------------------------------------------------------------");

  const confirmed = process.argv.includes("--broadcast") && process.env.CONFIRM === "MINT";
  if (!confirmed) {
    console.log("\nDRY RUN — nothing broadcast. Re-run with CONFIRM=MINT and --broadcast to mint.");
    return;
  }

  console.log("\nMinting…");
  const res = await mintHandleChild(wallet, { handle, buyerAddress: to, groupTokenId });
  console.log("\n=============================================================");
  console.log(" MINTED  @" + res.handle);
  console.log(" CHILD TOKEN ID (record in handles registry):");
  console.log("   ", res.childTokenId);
  console.log(" Explorer: https://explorer.e.cash/tx/" + res.childTokenId);
  console.log(" Broadcast txids:", res.broadcastTxids.join(", "));
  console.log("=============================================================");
}

main().catch((e) => { console.error(e); process.exit(1); });
