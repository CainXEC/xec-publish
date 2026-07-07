import type { Metadata } from "next";
import { createServerSupabase } from "@/lib/supabase-server";

const siteUrl = "https://www.proofofwriting.com";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username: rawUsername } = await params;
  const username =
    typeof rawUsername === "string" ? decodeURIComponent(rawUsername).trim() : "";
  if (!username) return {};

  const supabase = createServerSupabase();
  const { data: author } = await supabase
    .from("authors")
    .select("username, bio")
    .eq("username", username)
    .maybeSingle();

  const authorUsername = author?.username?.trim() || username;
  const bio =
    typeof author?.bio === "string" && author.bio.trim()
      ? author.bio.trim()
      : `Read articles by ${authorUsername} on Proof Of Writing.`;

  return {
    title: `${authorUsername} | Proof Of Writing`,
    description: bio,
    openGraph: {
      title: `${authorUsername} | Proof Of Writing`,
      description: bio,
      url: `${siteUrl}/u/${encodeURIComponent(authorUsername)}`,
      siteName: "Proof Of Writing",
      images: [
        {
          url: `${siteUrl}/api/og/site`,
          width: 1200,
          height: 630,
          alt: `${authorUsername} | Proof Of Writing`,
        },
      ],
      type: "profile",
    },
    twitter: {
      card: "summary_large_image",
      title: `${authorUsername} | Proof Of Writing`,
      description: bio,
      images: [`${siteUrl}/api/og/site`],
    },
  };
}

export default function AuthorSlugLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
