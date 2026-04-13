import type { Metadata } from "next";
import { getPublishedPostBySlug } from "@/lib/getPublishedPostBySlug";

const siteUrl = "https://www.proofofwriting.com";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  if (!slug) return {};

  const data = await getPublishedPostBySlug(slug);
  if (!data) return {};

  const { post } = data;

  const description = post.teaser?.slice(0, 160);

  return {
    title: `${post.title} | Proof Of Writing`,
    description,
    openGraph: {
      title: post.title,
      description,
      url: `${siteUrl}/posts/${post.slug}`,
      siteName: "Proof Of Writing",
      images: [
        {
          url: `${siteUrl}/og-image.png`,
          width: 1200,
          height: 630,
          alt: post.title,
        },
      ],
      type: "article",
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description,
      images: [`${siteUrl}/og-image.png`],
    },
  };
}

export default function PostSlugLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
