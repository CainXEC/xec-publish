// =============================================================================
//  app/marketplace/page.tsx  —  the public handle page (/marketplace)
//  Thin server component: metadata + mounts MarketplaceShell, which lays out
//  the mint flow + gallery (one column on phones, mint rail + wide filtered
//  gallery on desktop). This is the sole handle page — no separate /mint route.
// =============================================================================

import type { Metadata } from "next";
import MarketplaceShell from "@/components/MarketplaceShell";
import { getAuthedAccount } from "@/lib/authHelpers";

// Defining `openGraph` here REPLACES the root layout's openGraph object (Next
// shallow-merges top-level metadata keys, so a nested openGraph without images
// drops the inherited image and the card renders imageless). Redeclare the card
// explicitly. Same for twitter — declaring it lets the card carry the
// marketplace-specific title instead of inheriting the generic one.
//
// Bespoke "Handles" card (app/api/og/marketplace). Bump ?v= when the template
// changes — OG images are CDN-cached immutable, so a new v= re-renders every
// shared card. Relative URL resolves against the root layout's metadataBase.
const OG_IMAGE = {
  url: "/api/og/marketplace?v=1",
  width: 1200,
  height: 630,
  alt: "Claim a one-of-one @handle on Proof Of Writing",
};

export const metadata: Metadata = {
  title: "Handles — proofofwriting",
  description:
    "Claim a one-of-one @handle on eCash — a unique voxel monument, revealed only at mint — or browse handles listed for sale on Agora at live on-chain prices.",
  openGraph: {
    title: "Handles — proofofwriting",
    description:
      "Claim a one-of-one @handle on eCash, or buy one listed for sale on Agora.",
    url: "https://www.proofofwriting.com/marketplace",
    siteName: "Proof Of Writing",
    images: [OG_IMAGE],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Handles — proofofwriting",
    description:
      "Claim a one-of-one @handle on eCash, or buy one listed for sale on Agora.",
    images: [OG_IMAGE.url],
  },
};

export default async function MarketplacePage() {
  // Auth drives the shared header chrome only (dashboard link + notifications).
  const acct = await getAuthedAccount();
  return <MarketplaceShell signedIn={acct != null} isAuthor={acct?.authorId != null} />;
}
