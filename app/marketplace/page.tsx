// =============================================================================
//  app/marketplace/page.tsx  —  the public handle page (/marketplace)
//  Thin server component: metadata + mounts the combined mint + marketplace
//  flow. Mint a one-of-one @handle up top; browse handles listed for sale on
//  Agora below. This is the sole handle page — there is no separate /mint route.
// =============================================================================

import type { Metadata } from "next";
import MintHandle from "@/components/MintHandle";
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
  return <MintHandle signedIn={acct != null} isAuthor={acct?.authorId != null} />;
}
