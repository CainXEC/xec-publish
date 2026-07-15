import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Analytics } from "@vercel/analytics/next";
import {
  Geist,
  Geist_Mono,
  JetBrains_Mono,
  Newsreader,
} from "next/font/google";
import { Suspense } from "react";
import ScrollToTopOnRouteChange from "@/components/ScrollToTopOnRouteChange";
import NavProgress from "@/components/NavProgress";
import BottomNav from "@/components/feed/BottomNav";
import PresenceHeartbeat from "@/components/PresenceHeartbeat";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "700", "800"],
});

const newsreader = Newsreader({
  subsets: ["latin"],
  variable: "--font-newsreader",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

const siteUrl = "https://www.proofofwriting.com";
const defaultDescription =
  "Written by independent writers for independent thinkers. Pay with eCash to unlock the full story.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Proof Of Writing",
  description: defaultDescription,
  icons: {
    icon: [
      { url: "/favicon-32x32.png?v=4", type: "image/png", sizes: "32x32" },
      { url: "/icon-192.png?v=4", type: "image/png", sizes: "192x192" },
    ],
    apple: "/apple-touch-icon.png?v=4",
  },
  openGraph: {
    title: "Proof Of Writing",
    description: defaultDescription,
    url: siteUrl,
    siteName: "Proof Of Writing",
    images: [
      {
        url: "/og-site.png",
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
    images: ["/og-site.png"],
  },
};

const themeInitScript = `(function(){try{var t=localStorage.getItem("theme");if(!t){var m=document.cookie.match(/(?:^|; )theme=([^;]*)/);if(m)t=m[1];}var d;if(t==="light")d=false;else if(t==="dark")d=true;else d=window.matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.classList.toggle("dark",d);}catch(e){}})();`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const themeCookie = cookieStore.get("theme")?.value;
  const isDark = themeCookie === "dark";

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${jetbrainsMono.variable} ${newsreader.variable} h-full antialiased${isDark ? " dark" : ""}`}
    >
      <head>
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png?v=4" />
        <link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png?v=4" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png?v=4" />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <script
          dangerouslySetInnerHTML={{
            __html:
              "if ('scrollRestoration' in history) history.scrollRestoration = 'manual';",
          }}
        />
      </head>
      <body className="min-h-[100dvh]">
        <ScrollToTopOnRouteChange />
        <Suspense fallback={null}>
          <NavProgress />
        </Suspense>
        {children}
        <BottomNav />
        <PresenceHeartbeat />
        <Analytics />
      </body>
    </html>
  );
}
