// =============================================================================
//  app/mint/page.tsx  —  the public handle-minting route (/mint)
//  Thin server component: metadata + mounts the client mint flow.
// =============================================================================

import type { Metadata } from "next";
import MintHandle from "@/components/MintHandle";

export const metadata: Metadata = {
  title: "Mint a handle — proofofwriting",
  description:
    "Claim a one-of-one @handle on eCash. Each handle is a unique voxel monument, revealed only at mint.",
  openGraph: {
    title: "Mint a handle — proofofwriting",
    description: "Claim a one-of-one @handle on eCash.",
    url: "https://www.proofofwriting.com/mint",
    type: "website",
  },
};

export default function MintPage() {
  return <MintHandle />;
}
