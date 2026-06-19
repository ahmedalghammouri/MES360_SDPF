import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,

  // Self-contained server bundle — the production Docker stage copies
  // .next/standalone and runs `node server.js` (see apps/web/Dockerfile)
  output: 'standalone',

  // Pin the standalone file-tracing root to THIS app so the output is
  // flat (.next/standalone/server.js). Without this, Next infers the
  // tracing root from turbopack.root (the monorepo root) and nests the
  // bundle under .next/standalone/app/server.js, which breaks the
  // Docker image's `node server.js` entrypoint.
  outputFileTracingRoot: __dirname,

  // Monorepo root so Turbopack resolves cross-package paths
  // (e.g. tailwind content globs to ../../packages/ui) within
  // the filesystem boundary instead of panicking on root escape.
  turbopack: {
    root: path.join(__dirname, '..', '..'),
  },

  images: {
    domains: ['localhost', 'mes360.sa', 'storage.mes360.sa', 'mes360.industry360.sa', 'storage.industry360.sa'],
    formats: ['image/avif', 'image/webp'],
  },

  experimental: {
    optimizePackageImports: [
      'lucide-react',
      '@radix-ui/react-icons',
      'echarts',
      'recharts',
      'framer-motion',
      '@tanstack/react-query',
      '@radix-ui/react-dialog',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-select',
      '@radix-ui/react-tooltip',
      '@radix-ui/react-tabs',
      '@radix-ui/react-popover',
    ],
  },

  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
      };
    }
    return config;
  },

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
    ];
  },

};

export default nextConfig;
