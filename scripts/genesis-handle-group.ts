// =============================================================================
//  genesis-handle-group.ts
//  ONE-TIME, IMMUTABLE: creates the NFT1 GROUP token that every handle NFT is
//  minted from. The genesis transaction's txid BECOMES the collection's token
//  ID — save it; every child mint references it forever.
//
//  Verified against ecash-lib@4.12 / ecash-wallet@5.5.
//
//  SAFETY: dry-run by default (prints the plan, broadcasts nothing).
//  It only broadcasts when BOTH are set:  --broadcast  AND  CONFIRM=GENESIS
//
//    # 1) dry run — review everything:
//    MINT_WALLET_MNEMONIC="..." npx tsx genesis-handle-group.ts
//
//    # 2) for real, after funding the wallet and reviewing the dry run:
//    MINT_WALLET_MNEMONIC="..." CONFIRM=GENESIS npx tsx genesis-handle-group.ts --broadcast
//
//  Use a DEDICATED mint wallet (not your personal one). It will hold the group
//  token, the mint baton, and a little XEC for fees — nothing else.
// =============================================================================

import { Wallet } from "ecash-wallet";
import { ChronikClient } from "chronik-client";
import { SLP_TOKEN_TYPE_NFT1_GROUP, payment, fromHex } from "ecash-lib";

// ---- EDIT THESE before the real run ----------------------------------------
const GENESIS_INFO = {
  tokenName: "ProofofWriting Handles",
  tokenTicker: "POWH",
  url: "https://proofofwriting.com",
  decimals: 0,            // NFTs are whole units — must be 0
};
const SUPPLY = 1_000_000n;       // group cap = max handle NFTs (baton kept → extendable)
const INCLUDE_MINT_BATON = true; // keep a baton so the cap is extendable later
const CHRONIK_URLS = ["https://chronik.e.cash", "https://chronik-native.fabien.cash"];
// ----------------------------------------------------------------------------

async function main() {
  const mnemonic = process.env.MINT_WALLET_MNEMONIC;
  const skHex = process.env.MINT_WALLET_SK;
  if (!mnemonic && !skHex) {
    console.error("Set MINT_WALLET_MNEMONIC (Cashtab seed) or MINT_WALLET_SK (hex private key).");
    process.exit(1);
  }

  const chronik = new ChronikClient(CHRONIK_URLS);
  const wallet = skHex
    ? Wallet.fromSk(fromHex(skHex), chronik)
    : Wallet.fromMnemonic(mnemonic!, chronik);

  console.log("Mint wallet address :", wallet.address);
  await wallet.sync();
  const xec = Number(wallet.balanceSats) / 100;
  console.log("Balance             :", xec.toLocaleString(), "XEC");

  // --- assemble the genesis action ------------------------------------------
  // outputs[0] is the mandatory blank OP_RETURN slot for token actions.
  // outputs[1] receives the full group supply to the mint wallet.
  // outputs[2] (optional) is the mint baton, also to the mint wallet.
  // NB: token outputs must ALSO carry their dust sats (546) — this ecash-wallet
  // version validates every output has `sats`.
  const DUST = 546n;
  const outputs: any[] = [
    { sats: 0n },
    {
      sats: DUST,
      address: wallet.address,
      tokenId: payment.GENESIS_TOKEN_ID_PLACEHOLDER,
      atoms: SUPPLY,
      isMintBaton: false,
    },
  ];
  if (INCLUDE_MINT_BATON) {
    outputs.push({
      sats: DUST,
      address: wallet.address,
      tokenId: payment.GENESIS_TOKEN_ID_PLACEHOLDER,
      atoms: 0n,
      isMintBaton: true,
    });
  }

  const action = {
    outputs,
    tokenActions: [
      { type: "GENESIS", tokenType: SLP_TOKEN_TYPE_NFT1_GROUP, genesisInfo: GENESIS_INFO },
    ],
  };

  console.log("\n--- GENESIS PLAN ---------------------------------------------");
  console.log("token type   : NFT1 GROUP (129)");
  console.log("name         :", GENESIS_INFO.tokenName);
  console.log("ticker       :", GENESIS_INFO.tokenTicker);
  console.log("url          :", GENESIS_INFO.url);
  console.log("decimals     :", GENESIS_INFO.decimals);
  console.log("supply (cap) :", SUPPLY.toLocaleString(), "→ max handle NFTs");
  console.log("mint baton   :", INCLUDE_MINT_BATON ? "yes (cap extendable later)" : "no (cap permanently fixed)");
  console.log("recipient    :", wallet.address);
  console.log("--------------------------------------------------------------");

  const confirmed = process.argv.includes("--broadcast") && process.env.CONFIRM === "GENESIS";
  if (!confirmed) {
    console.log("\nDRY RUN — nothing broadcast.");
    try {
      const inspected = wallet.action(action as any).inspect();
      console.log("\nInspect (what would be built):");
      console.log(JSON.stringify(inspected, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
    } catch (e: any) {
      console.log("(inspect unavailable:", e.message + ")");
    }
    console.log("\nTo broadcast for real: re-run with  CONFIRM=GENESIS  and  --broadcast");
    return;
  }

  if (wallet.balanceSats < 1000n) {
    console.error("\nBalance too low for fees. Fund the mint wallet with a little XEC and re-run.");
    process.exit(1);
  }

  console.log("\nBroadcasting genesis…");
  const built = wallet.action(action as any).build();
  const resp = await built.broadcast();
  const txid = (resp as any).txid ?? resp;
  console.log("\n=============================================================");
  console.log(" GENESIS BROADCAST. GROUP TOKEN ID (save this forever):");
  console.log("   ", txid);
  console.log(" Explorer: https://explorer.e.cash/tx/" + txid);
  console.log("=============================================================");
  console.log("This is GROUP_TOKEN_ID — every handle child mint references it.");
}

main().catch((e) => { console.error(e); process.exit(1); });