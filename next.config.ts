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
      { source: '/@:identifier', destination: '/profile/:identifier' },
    ]
  },
  async redirects() {
    return [
      {
        source: '/0',
        destination: '/00',
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
