import type { Metadata } from "next";

const siteUrl = "https://www.proofofwriting.com";
const title = "Leaderboard | Proof Of Writing";
const description =
  "See the top writers and most unlocked articles on Proof Of Writing.";

export const metadata: Metadata = {
  title,
  description,
  openGraph: {
    title,
    description,
    url: `${siteUrl}/leaderboard`,
    siteName: "Proof Of Writing",
    images: [
      {
        url: `${siteUrl}/og-image.png`,
        width: 1200,
        height: 630,
        alt: title,
      },
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: [`${siteUrl}/og-image.png`],
  },
};

export default function LeaderboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
