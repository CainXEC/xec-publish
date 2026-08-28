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
import ThemeSync from "@/components/ThemeSync";
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
  "Pay-per-read publishing on eCash. Unlock the full story with XEC.";

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

// Runs before first paint. Precedence is COOKIE-FIRST — deliberately the same
// source the server used to render <html> above — then localStorage, then a
// DARK default: with no stored choice a first-time visitor opens in dark
// (the terminal look is the brand), regardless of the OS preference. Matching
// the server's default (dark unless the cookie says "light") is what prevents
// the "load in one theme, then flip" jump. It also re-persists BOTH the cookie
// and localStorage from the resolved value, so (a) they can't drift apart and
// (b) refreshing the cookie every visit dodges Safari's 7-day cap on script-set
// cookies, which used to let the cookie silently expire while localStorage
// survived. Cross-tab changes are handled live by ThemeSync.
const themeInitScript = `(function(){try{var m=document.cookie.match(/(?:^|; )theme=([^;]*)/);var c=m?m[1]:null;var ls=null;try{ls=localStorage.getItem("theme")}catch(e){}var t=c||ls;var d;if(t==="light")d=false;else d=true;document.documentElement.classList.toggle("dark",d);var v=d?"dark":"light";try{localStorage.setItem("theme",v)}catch(e){}document.cookie="theme="+v+"; path=/; max-age=31536000; samesite=lax";}catch(e){}})();`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const themeCookie = cookieStore.get("theme")?.value;
  // Dark by default: only an explicit "light" cookie renders light. No cookie
  // (first-time visitor) → dark, matching themeInitScript so there's no flash.
  const isDark = themeCookie !== "light";

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
        <ThemeSync />
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
