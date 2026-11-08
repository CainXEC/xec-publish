// =============================================================================
//  handleRoutes.ts — where "get a handle" links go.
//
//  Two handle pages, two very different audiences — don't mix them up:
//    • /marketplace  — the mint flow (MarketplaceShell → MintHandle). Anyone picks
//                      a new name and pays in XEC or, signed in, POW. Every "mint
//                      a handle" CTA for an ordinary user belongs here.
//    • /claim-handle — the grandfather claim (ClaimHandle). ONLY for authors who
//                      had a username before handles moved on-chain and hold a
//                      one-time claim code. A new user who lands here has nothing
//                      to enter — it's a dead end for them.
// =============================================================================

export type PayWith = "xec" | "pow";

/** The one page where a new handle is picked and minted. */
export const MINT_HANDLE_PATH = "/marketplace";

/** Grandfathered-author claim page (needs a one-time claim code). */
export const CLAIM_HANDLE_PATH = "/claim-handle";

/**
 * Link into the mint flow. `payWith: "pow"` pre-selects "Pay with POW" — used
 * right after the welcome gift, whose 10 POW pays for a base-tier handle but
 * whose XEC (2,500) doesn't cover the 10,000 XEC price the page defaults to.
 */
export function mintHandleHref({ payWith }: { payWith?: PayWith } = {}): string {
  return payWith === "pow" ? `${MINT_HANDLE_PATH}?pay=pow` : MINT_HANDLE_PATH;
}

/**
 * The mint flow's starting pay-with choice, from the page's query string
 * (`?pay=pow`). POW needs login (the server matches a POW send by the account's
 * proven addresses), so a signed-out visitor always starts on XEC.
 */
export function initialPayWith(search: string, signedIn: boolean): PayWith {
  if (!signedIn) return "xec";
  return new URLSearchParams(search).get("pay") === "pow" ? "pow" : "xec";
}
