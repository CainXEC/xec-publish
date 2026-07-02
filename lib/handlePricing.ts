// =============================================================================
//  handlePricing.ts
//  Length-tiered handle pricing (decision 3). Shorter = scarcer = pricier.
//  THE XEC AMOUNTS BELOW ARE PLACEHOLDERS — set them to your market.
//  XEC has 2 decimal places, so 1 XEC = 100 base units ("sats").
// =============================================================================

export type Tier = "premium" | "rare" | "standard" | "base";

export interface HandlePrice {
  tier: Tier;
  priceXec: number;
  priceSats: number;
  /** 1–2 char names: you decided to auction these, not flat-sell them.
   *  When true, the mint page should route to the auction flow instead of a
   *  direct buy. (Until the auction exists, you can flat-sell by ignoring it.) */
  auctionOnly: boolean;
}

export function priceForHandle(handle: string): HandlePrice {
  const n = handle.length;
  let tier: Tier;
  let priceXec: number;
  let auctionOnly = false;

  if (n <= 2) {
    tier = "premium";
    priceXec = 1_000_000; // placeholder floor; you plan to auction these
    auctionOnly = true;
  } else if (n <= 4) {
    tier = "rare";
    priceXec = 250_000;   // placeholder
  } else if (n <= 6) {
    tier = "standard";
    priceXec = 50_000;    // placeholder
  } else {
    tier = "base";
    priceXec = 10_000;    // placeholder
  }

  return { tier, priceXec, priceSats: priceXec * 100, auctionOnly };
}
