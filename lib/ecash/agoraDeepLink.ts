// =============================================================================
//  lib/ecash/agoraDeepLink.ts — build Cashtab Agora action deep links.
//
//  Cashtab standard "agora-deeplink" (Bitcoin ABC D20335): a URL that opens
//  Cashtab straight into an Agora action for one token, so a holder can LIST a
//  handle (with the ask price prefilled) or a buyer can BUY one, in a single tap
//  — no hunting for the token in the wallet, no re-typing the price.
//
//    https://cashtab.com/#/token/<tokenId>?action=LIST&price=<xec>
//    https://cashtab.com/#/token/<tokenId>?action=BUY
//
//  Handles are one-of-one NFTs (oneshot offers, quantity 1), so `price` is the
//  whole ask in XEC and `quantity` never applies. We only build URLs — the
//  listing/purchase itself is signed in Cashtab and settled on-chain; we take no
//  custody. fetchActiveHandleOffers() (lib/agoraMarketplace.ts) reads the
//  resulting live listing back into the gallery.
// =============================================================================

const TOKEN_BASE = "https://cashtab.com/#/token/";

/** Canonical decimal XEC for the deep link: no thousands separators, no
 *  scientific notation, up to 2 decimals (our amounts are sats/100), trailing
 *  zeros trimmed. The spec parses `price` as a plain "."-decimal, NOT locale —
 *  so never hand it a grouped or exponential string. */
export function xecDecimal(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "";
  // toFixed(2) avoids exponent form across our whole range (1 .. 1e12) and pins
  // the decimals; then drop a trailing ".00" / ".x0" so whole XEC stays clean.
  return n.toFixed(2).replace(/\.?0+$/, "");
}

/** LIST deep link for a handle NFT, with the ask price prefilled when given.
 *  Omit `priceXec` (or pass null/0) to open the list flow with no price set. */
export function agoraListLink(tokenId: string, priceXec?: number | null): string {
  const base = `${TOKEN_BASE}${tokenId}?action=LIST`;
  const price = priceXec == null ? "" : xecDecimal(priceXec);
  return price ? `${base}&price=${price}` : base;
}

/** BUY deep link for a handle NFT (oneshot → no quantity). */
export function agoraBuyLink(tokenId: string): string {
  return `${TOKEN_BASE}${tokenId}?action=BUY`;
}
