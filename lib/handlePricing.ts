// =============================================================================
//  handlePricing.ts
//  Three-tier flat handle pricing. Shorter = scarcer = pricier.
//  XEC has 2 decimal places, so 1 XEC = 100 base units ("sats").
//
//    1–5   chars  -> short     1,000,000 XEC  (~$5)
//    6–10  chars  -> mid         100,000 XEC  (~$0.50)
//    11+   chars  -> base         10,000 XEC  (~$0.05)
//
//  No auction tier: every valid handle is directly mintable at a flat price.
// =============================================================================
export type Tier = "short" | "mid" | "base";
export interface HandlePrice {
  tier: Tier;
  priceXec: number;
  priceSats: number;
  /** Retained for API compatibility with the mint/claim flows. Always false now
   *  (no auction-only tier). Kept so callers that read it don't need changes. */
  auctionOnly: boolean;
}
export function priceForHandle(handle: string): HandlePrice {
  const n = handle.length;
  let tier: Tier;
  let priceXec: number;
  if (n <= 5) {
    tier = "short";
    priceXec = 1_000_000;
  } else if (n <= 10) {
    tier = "mid";
    priceXec = 100_000;
  } else {
    tier = "base";
    priceXec = 10_000;
  }
  return { tier, priceXec, priceSats: priceXec * 100, auctionOnly: false };
}
