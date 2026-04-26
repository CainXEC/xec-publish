import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Analytics } from "@vercel/analytics/next";
import { Geist, Geist_Mono, Newsreader } from "next/font/google";
import Footer from "@/components/Footer";
import ScrollToTopOnRouteChange from "@/components/ScrollToTopOnRouteChange";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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
      className={`${geistSans.variable} ${geistMono.variable} ${newsreader.variable} h-full antialiased${isDark ? " dark" : ""}`}
    >
      <head>
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="apple-touch-icon" href="/favicon.svg" />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <script
          dangerouslySetInnerHTML={{
            __html:
              "if ('scrollRestoration' in history) history.scrollRestoration = 'manual';",
          }}
        />
      </head>
      <body className="min-h-screen">
        <ScrollToTopOnRouteChange />
        {children}
        <Footer />
        <Analytics />
      </body>
    </html>
  );
}
