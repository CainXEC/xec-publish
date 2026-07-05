// =============================================================================
//  app/marketplace/page.tsx  —  legacy /marketplace route
//  The marketplace now lives on the mint page, below the mint flow. This route
//  permanently redirects so old links and bookmarks land on the listings.
// =============================================================================

import { permanentRedirect } from "next/navigation";

export default function MarketplacePage() {
  permanentRedirect("/mint#marketplace");
}
