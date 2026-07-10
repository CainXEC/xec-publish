import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  serverExternalPackages: ['jsdom', '@resvg/resvg-js'],
  outputFileTracingIncludes: {
    '/api/**': ['./assets/fonts/**'],
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
