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

  const data = await getPublishedPostBySlug(slug);
  if (!data) return {};

  const { post, author } = data;
  const authorUsername = author?.username?.trim() ?? "";

  return articleOpenGraphMetadata({
    post,
    authorUsername,
    pageUrl: `${siteUrl}/posts/${encodeURIComponent(post.slug)}`,
  });
}

export default function PostSlugLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
