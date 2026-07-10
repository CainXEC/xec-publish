import type { Metadata } from "next";
import { getFeedPostForCard } from "@/lib/getFeed";
import { feedOpenGraphMetadata } from "@/lib/feedOgMetadata";

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL || "https://www.proofofwriting.com";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ txid: string }>;
}): Promise<Metadata> {
  const { txid } = await params;
  const post = await getFeedPostForCard(txid);
  // Missing, or a soft-deleted post with no content: fall back to the site-wide
  // card from the root layout rather than advertising an empty/removed post.
  if (!post || !post.content) return {};

  return feedOpenGraphMetadata({
    post,
    pageUrl: `${siteUrl}/feed/${post.txid}`,
  });
}

export default function FeedThreadLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
