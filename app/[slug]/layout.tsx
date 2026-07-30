import type { Metadata } from "next";
import { articleOpenGraphMetadata } from "@/lib/articleOgMetadata";
import { getPublishedPostBySlug } from "@/lib/getPublishedPostBySlug";

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL || "https://www.proofofwriting.com";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  if (!slug) return {};

  const data = await getPublishedPostBySlug(slug, true);
  if (!data) return {};

  const { post, author } = data;
  // The card byline is the account's live handle only. The legacy
  // authors.username is never surfaced (it would render as "@<old-name>" and
  // read as a real handle); a handle-less author's card simply omits the byline
  // rather than showing a stale imported name.
  const authorUsername = author?.display_handle?.trim() || "";

  return articleOpenGraphMetadata({
    post,
    authorUsername,
    authorIsAi: author?.is_ai === true,
    pageUrl: `${siteUrl}/${encodeURIComponent(post.slug)}`,
  });
}

export default function LegacySlugLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
