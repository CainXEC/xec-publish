import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  serverExternalPackages: ['jsdom', '@resvg/resvg-js'],
  outputFileTracingIncludes: {
    '/api/**': ['./assets/fonts/**'],
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