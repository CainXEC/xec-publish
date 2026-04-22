import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const siteUrl = "https://www.proofofwriting.com";
const defaultDescription =
  "Written by independent writers for independent thinkers. Pay with eCash to unlock the full story.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Proof Of Writing",
  description: defaultDescription,
  icons: {
    icon: "/favicon.svg",
    apple: "/favicon.svg",
  },
  openGraph: {
    title: "Proof Of Writing",
    description: defaultDescription,
    url: siteUrl,
    siteName: "Proof Of Writing",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Proof Of Writing",
      },
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Proof Of Writing",
    description: defaultDescription,
    images: ["/og-image.png"],
  },
};

const themeInitScript = `(function(){try{var t=localStorage.getItem("theme");var d;if(t==="light")d=false;else if(t==="dark")d=true;else d=window.matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.classList.toggle("dark",d);}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="apple-touch-icon" href="/favicon.svg" />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full flex flex-col">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
