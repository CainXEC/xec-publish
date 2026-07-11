import ClaimHandle from "@/components/ClaimHandle";
import { getAuthedAccount } from "@/lib/authHelpers";

export const metadata = {
  title: "Claim your handle — proofofwriting",
};

export default async function ClaimHandlePage() {
  // Auth only steers the post-claim CTA (profile vs. dashboard/login).
  const acct = await getAuthedAccount();
  return <ClaimHandle signedIn={acct != null} />;
}
