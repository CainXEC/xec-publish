// =============================================================================
//  app/marketplace/page.tsx  —  the public handle marketplace (/marketplace)
//  Thin server component: metadata + mounts the client grid, which reads the
//  live Agora listings for the handle group.
// =============================================================================

import type { Metadata } from "next";
import MarketplaceClient from "@/components/MarketplaceClient";

export const metadata: Metadata = {
  title: "Handle marketplace — proofofwriting",
  description:
    "Browse one-of-one @handles listed for sale on Agora. Live on-chain prices; buy directly in Cashtab.",
  openGraph: {
    title: "Handle marketplace — proofofwriting",
    description: "One-of-one @handles for sale on eCash, live on-chain prices.",
    url: "https://www.proofofwriting.com/marketplace",
    type: "website",
  },
};

export default function MarketplacePage() {
  return <MarketplaceClient />;
}
