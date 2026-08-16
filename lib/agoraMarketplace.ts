// =============================================================================
//  agoraMarketplace.ts
//  Read-only view of the handle marketplace, straight from the chain.
//
//  Handles are NFT1-child tokens minted under one group (GROUP_TOKEN_ID). When
//  a holder lists a handle for sale, the NFT is locked into an Agora "oneshot"
//  covenant with the price baked in. We ask Agora for every active offer in the
//  handle group in one call — that IS the marketplace. An offer disappears from
//  this list the moment it's bought or cancelled on-chain, so there is nothing
//  to poll, expire, or reconcile.
//
//  The price shown is the on-chain asked price (askedSats), converted to XEC
//  (1 XEC = 100 sats). We never store listings ourselves.
// =============================================================================

import { ChronikClient } from "chronik-client";
import { Agora } from "ecash-agora";
import { shaRmd160, toHex } from "ecash-lib";
import { encodeCashAddress } from "ecashaddrjs";
import { CHRONIK_AGORA_URLS } from "@/lib/ecash/chronikEndpoints";

// Agora needs a Chronik instance with the "agora" plugin loaded. The public
// chronik.e.cash node does NOT load it and 404s the plugin route; the "native"
// fabien.cash nodes DO — hence the native-only CHRONIK_AGORA_URLS set.
let _chronik: ChronikClient | null = null;
let _agora: Agora | null = null;
const chronik = () => (_chronik ??= new ChronikClient(CHRONIK_AGORA_URLS));
const agora = () => (_agora ??= new Agora(chronik()));

const SATS_PER_XEC = 100n;

export interface HandleOffer {
  /** The child NFT token id — joins to handles.token_id. */
  tokenId: string;
  /** On-chain asked price, in sats. */
  priceSats: bigint;
  /** Asked price in XEC (priceSats / 100), for display. */
  priceXec: number;
  /** The seller's eCash address, derived from the oneshot's cancel pubkey
   *  (only that key can cancel/relist → it IS the lister). Used to route an
   *  offer/bell to whoever listed the handle, even while the NFT sits in the
   *  Agora escrow covenant (so the on-chain "holder" is the covenant, not them).
   *  null only if the pubkey couldn't be encoded (shouldn't happen). */
  sellerAddress: string | null;
}

/** satoshis (bigint) -> XEC number, keeping 2dp (1 XEC = 100 sats). */
function satsToXec(sats: bigint): number {
  const whole = sats / SATS_PER_XEC;
  const frac = sats % SATS_PER_XEC;
  return Number(whole) + Number(frac) / 100;
}

/** The lister's P2PKH eCash address from a oneshot's cancel pubkey. Same
 *  hash160→cashaddr path used across the app (lib/pocket/derive.js, walletAuth). */
function sellerAddressFromCancelPk(cancelPk: Uint8Array): string | null {
  try {
    return encodeCashAddress("ecash", "p2pkh", toHex(shaRmd160(cancelPk)));
  } catch {
    return null;
  }
}

/**
 * Every handle currently listed for sale on Agora, keyed by token id.
 * BEST-EFFORT: if Chronik/Agora is unavailable this throws; callers should
 * treat a failure as "marketplace temporarily unavailable", not "empty".
 */
export async function fetchActiveHandleOffers(): Promise<HandleOffer[]> {
  const groupTokenId = process.env.GROUP_TOKEN_ID;
  if (!groupTokenId) throw new Error("GROUP_TOKEN_ID is not configured");

  const offers = await agora().activeOffersByGroupTokenId(groupTokenId);

  const out: HandleOffer[] = [];
  for (const offer of offers) {
    // Handles are one-of-one NFTs → oneshot offers. Skip anything else.
    const variant = offer.variant;
    if (variant.type !== "ONESHOT") continue;
    const tokenId = offer.token?.tokenId;
    if (!tokenId) continue;
    const priceSats = offer.askedSats();
    out.push({
      tokenId,
      priceSats,
      priceXec: satsToXec(priceSats),
      sellerAddress: sellerAddressFromCancelPk(variant.params.cancelPk),
    });
  }
  return out;
}

/**
 * The seller's eCash address for ONE listed handle, or null if it isn't
 * currently listed. One targeted Agora query (activeOffersByTokenId) — used by
 * the offer routes to route a bid/bell to whoever listed the handle. Throws if
 * Chronik/Agora is unreachable (callers treat that as "couldn't resolve").
 */
export async function fetchListedSellerAddress(tokenId: string): Promise<string | null> {
  const offers = await agora().activeOffersByTokenId(tokenId);
  for (const offer of offers) {
    const variant = offer.variant;
    if (variant.type !== "ONESHOT") continue;
    if (offer.token?.tokenId !== tokenId) continue;
    return sellerAddressFromCancelPk(variant.params.cancelPk);
  }
  return null;
}
