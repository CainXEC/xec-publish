// =============================================================================
//  app/mint/page.tsx  —  the public handle-minting route (/mint)
//  Thin server component: metadata + mounts the client mint flow.
// =============================================================================

import type { Metadata } from "next";
import MintHandle from "@/components/MintHandle";

export const metadata: Metadata = {
  title: "Mint a handle — proofofwriting",
  description:
    "Claim a one-of-one @handle on eCash — a unique voxel monument, revealed only at mint — or browse handles listed for sale on Agora at live on-chain prices.",
  openGraph: {
    title: "Mint a handle — proofofwriting",
    description:
      "Claim a one-of-one @handle on eCash, or buy one listed for sale on Agora.",
    url: "https://www.proofofwriting.com/mint",
    type: "website",
  },
};

export default function MintPage() {
  return <MintHandle />;
}
