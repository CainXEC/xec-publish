// =============================================================================
//  mintHandleChild.ts
//  Mints ONE handle NFT: an NFT1 CHILD genesis that consumes 1 unit of the
//  group token and delivers the new NFT to the buyer — mint + delivery in one
//  transaction. Verified against ecash-lib@4.12 / ecash-wallet@5.5.
//
//  ecash-wallet auto-handles the group input: if the wallet lacks a qty-1
//  group UTXO, it chains a SEND to split one off, then the child genesis.
//
//  ⚠ SERIALIZE calls to this: every mint spends the group token's UTXO(s), so
//  concurrent mints would race. The mint engine must run them one at a time.
// =============================================================================

import { Wallet } from "ecash-wallet";
import { ChronikClient } from "chronik-client";
import { SLP_TOKEN_TYPE_NFT1_CHILD, payment, fromHex } from "ecash-lib";
import { displayHandle } from "./handleSkeleton";

export interface MintHandleParams {
  handle: string;           // chosen handle (display form)
  buyerAddress: string;     // ecash:... address to receive the NFT
  groupTokenId: string;     // GROUP_TOKEN_ID from the genesis step
  profileUrlBase?: string;  // default "https://proofofwriting.com/@" → url = base + handle
  ticker?: string;          // default: the handle
}

export interface MintHandleResult {
  childTokenId: string;     // == the genesis txid; this IS the NFT's id — record it
  handle: string;
  url: string;
  broadcastTxids: string[];
}

/**
 * Mint one handle NFT with an already-constructed mint Wallet.
 * Syncs the wallet, builds the child genesis, captures the child token id from
 * the built tx, then broadcasts. Call this serially (see warning above).
 */
export async function mintHandleChild(wallet: Wallet, params: MintHandleParams): Promise<MintHandleResult> {
  const handle = displayHandle(params.handle);
  const url = (params.profileUrlBase ?? "https://proofofwriting.com/@") + handle;

  await wallet.sync();

  const action = {
    outputs: [
      { sats: 0n },                                    // mandatory OP_RETURN slot
      {
        sats: 546n,                                    // dust — this ecash-wallet requires token outputs to declare sats
        address: params.buyerAddress,                  // deliver the NFT to the buyer
        tokenId: payment.GENESIS_TOKEN_ID_PLACEHOLDER, // child id not known until minted
        atoms: 1n,                                     // an NFT is exactly 1
        isMintBaton: false,
      },
    ],
    tokenActions: [
      {
        type: "GENESIS",
        tokenType: SLP_TOKEN_TYPE_NFT1_CHILD,
        genesisInfo: {
          tokenName: handle,
          tokenTicker: params.ticker ?? handle,
          url,
          decimals: 0,
        },
        groupTokenId: params.groupTokenId,             // consumes 1 group unit
      },
    ],
  };

  const built: any = wallet.action(action as any).build();
  const resp: any = await built.broadcast();
  if (resp && resp.success === false) {
    throw new Error("mint broadcast failed: " + JSON.stringify(resp));
  }
  // The broadcast returns { success, broadcasted: [txid, ...] }. NFT1-child mints
  // may chain two txs (split a qty-1 group unit, then the child genesis); the
  // child genesis is the LAST tx, and its txid IS the child token id.
  const broadcasted: string[] = Array.isArray(resp?.broadcasted)
    ? resp.broadcasted
    : Array.isArray(resp) ? resp : [];
  const childTokenId = broadcasted[broadcasted.length - 1];
  if (!childTokenId) throw new Error("mint broadcast returned no txid: " + JSON.stringify(resp));

  return { childTokenId, handle, url, broadcastTxids: broadcasted };
}

/** Build the mint wallet (holds the group token, baton, and fee XEC). */
export function loadMintWallet(
  chronikUrls: string[],
  creds: { mnemonic?: string; skHex?: string }
): Wallet {
  const chronik = new ChronikClient(chronikUrls);
  if (creds.skHex) return Wallet.fromSk(fromHex(creds.skHex), chronik);
  if (creds.mnemonic) return Wallet.fromMnemonic(creds.mnemonic, chronik);
  throw new Error("Provide mnemonic or skHex for the mint wallet.");
}
