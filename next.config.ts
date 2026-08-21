import type { NextConfig } from "next";

// Content-Security-Policy, REPORT-ONLY for now. The Pocket keeps a spending
// key in the browser, which raises the stakes on XSS — but an *enforced* CSP
// on Next App Router needs nonce-based inline-script handling (middleware)
// and a careful rollout. Step 1 is observing: this header logs would-be
// violations to the console without breaking anything. Origins covered:
// Chronik REST+WS (payments), Supabase, Vercel analytics/insights, Google
// Fonts, Cashtab QR/data images. Tighten + enforce as its own follow-up.
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  // Next injects inline bootstrap scripts; 'wasm-unsafe-eval' for ecash-lib.
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://va.vercel-scripts.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https:",
  [
    "connect-src 'self'",
    'https://chronik.e.cash wss://chronik.e.cash',
    'https://chronik-native1.fabien.cash wss://chronik-native1.fabien.cash',
    'https://chronik-native2.fabien.cash wss://chronik-native2.fabien.cash',
    'https://chronik-native3.fabien.cash wss://chronik-native3.fabien.cash',
    'https://*.supabase.co wss://*.supabase.co',
    'https://va.vercel-scripts.com https://vitals.vercel-insights.com',
  ].join(' '),
  // Embedded YouTube players (feed posts + top-level forum posts) — the only
  // external frame source. Privacy-enhanced host; youtube.com allowed for the
  // player's own redirects. No frame-src otherwise falls back to default-src
  // 'self', which would block the embed when this CSP is enforced.
  "frame-src https://www.youtube-nocookie.com https://www.youtube.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

const nextConfig: NextConfig = {
  serverExternalPackages: ['jsdom', '@resvg/resvg-js'],
  outputFileTracingIncludes: {
    '/api/**': ['./assets/fonts/**'],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy-Report-Only', value: CSP_REPORT_ONLY },
        ],
      },
    ]
  },
  async rewrites() {
    return [
      // Pretty profile URLs: the address bar shows /@simon (or /@qq703j…),
      // internally served by app/profile/[identifier]/page.js. Handles have no
      // slashes and never start with a char that collides with legacy post
      // slugs, so this is unambiguous.
      //
      // The articles sub-page (/@simon/articles) needs its own rule — the single
      // -segment rule above won't match a two-segment path — and must come first.
      { source: '/@:identifier/articles', destination: '/profile/:identifier/articles' },
      { source: '/@:identifier', destination: '/profile/:identifier' },
    ]
  },
  async redirects() {
    return [
      {
        // The feed is now the homepage; keep the old /feed URL working.
        // Matches /feed exactly — thread pages at /feed/:txid are untouched.
        source: '/feed',
        destination: '/',
        permanent: true,
      },
      {
        // The standalone articles browse page was removed; articles are now
        // discovered via author profiles and shared into the main feed. Send
        // old /articles bookmarks to the home feed.
        source: '/articles',
        destination: '/',
        permanent: true,
      },
      {
        source: '/0',
        destination: '/00',
        permanent: true,
      },
      {
        // Article-authoring page renamed from /dashboard/new-post.
        source: '/dashboard/new-post',
        destination: '/dashboard/new-article',
        permanent: true,
      },
      {
        source: '/:path*',
        has: [
          {
            type: 'host',
            value: 'xec-publish.vercel.app',
          },
        ],
        destination: 'https://www.proofofwriting.com/:path*',
        permanent: true,
      },
    ]
  },
}
export default nextConfig;
