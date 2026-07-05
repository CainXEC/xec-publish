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

// Agora needs a Chronik instance with the "agora" plugin loaded. The general
// public nodes (chronik.e.cash, etc.) do NOT load it and 404 the plugin route;
// the "native" fabien.cash nodes DO — they're the ones Cashtab uses for Agora.
const CHRONIK_URLS = [
  "https://chronik-native1.fabien.cash",
  "https://chronik-native2.fabien.cash",
  "https://chronik-native3.fabien.cash",
];

let _chronik: ChronikClient | null = null;
let _agora: Agora | null = null;
const chronik = () => (_chronik ??= new ChronikClient(CHRONIK_URLS));
const agora = () => (_agora ??= new Agora(chronik()));

const SATS_PER_XEC = 100n;

export interface HandleOffer {
  /** The child NFT token id — joins to handles.token_id. */
  tokenId: string;
  /** On-chain asked price, in sats. */
  priceSats: bigint;
  /** Asked price in XEC (priceSats / 100), for display. */
  priceXec: number;
}

/** satoshis (bigint) -> XEC number, keeping 2dp (1 XEC = 100 sats). */
function satsToXec(sats: bigint): number {
  const whole = sats / SATS_PER_XEC;
  const frac = sats % SATS_PER_XEC;
  return Number(whole) + Number(frac) / 100;
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
    if (offer.variant.type !== "ONESHOT") continue;
    const tokenId = offer.token?.tokenId;
    if (!tokenId) continue;
    const priceSats = offer.askedSats();
    out.push({ tokenId, priceSats, priceXec: satsToXec(priceSats) });
  }
  return out;
}
