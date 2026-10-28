// Modified by Tofu on 2026-10-28: no service worker headers (public/sw.js is
// gone), avatars up to 3 MB reach the upload action, and CHANGELOG.md, which the
// About dialog reads, is traced into the server build (see TOFU.md).
import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';

const nextConfig: NextConfig = {
  /* config options here */
  output: 'standalone',
  experimental: {
    serverActions: {
      // Tofu: an avatar of up to 3 MB (lib/avatar.ts) plus the form around it.
      bodySizeLimit: '4mb',
    },
  },
  outputFileTracingIncludes: {
    '/*': ['./CHANGELOG.md'],
  },
  webpack: (config) => {
    config.module.rules.push({
      test: /\.md$/,
      use: 'raw-loader'
    })
    return config
  },
  // PWA
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
        ],
      },
    ]
  },
};

const withNextIntl = createNextIntlPlugin();
export default withNextIntl(nextConfig);
