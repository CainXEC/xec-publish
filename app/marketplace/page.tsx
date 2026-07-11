// =============================================================================
//  app/marketplace/page.tsx  —  the public handle page (/marketplace)
//  Thin server component: metadata + mounts MarketplaceShell, which lays out
//  the mint flow + gallery (one column on phones, mint rail + wide filtered
//  gallery on desktop). This is the sole handle page — no separate /mint route.
// =============================================================================

import type { Metadata } from "next";
import MarketplaceShell from "@/components/MarketplaceShell";
import { getAuthedAccount } from "@/lib/authHelpers";

export const metadata: Metadata = {
  title: "Handles — proofofwriting",
  description:
    "Claim a one-of-one @handle on eCash — a unique voxel monument, revealed only at mint — or browse handles listed for sale on Agora at live on-chain prices.",
  openGraph: {
    title: "Handles — proofofwriting",
    description:
      "Claim a one-of-one @handle on eCash, or buy one listed for sale on Agora.",
    url: "https://www.proofofwriting.com/marketplace",
    type: "website",
  },
};

export default async function MarketplacePage() {
  // Auth drives the shared header chrome only (dashboard link + notifications).
  const acct = await getAuthedAccount();
  return <MarketplaceShell signedIn={acct != null} isAuthor={acct?.authorId != null} />;
}
