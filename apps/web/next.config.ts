import path from 'node:path';
import type { NextConfig } from 'next';

const monorepoRoot = path.join(import.meta.dirname, '..', '..');

const config: NextConfig = {
  reactStrictMode: true,
  // packages/shared is imported by both apps; let the bundler read outside apps/web.
  turbopack: { root: monorepoRoot },
  // Local dev only: same-origin /api → the Express dev server. On Vercel the
  // Express app is a function at /api (see vercel.json), so nothing is proxied.
  async rewrites() {
    if (process.env.NODE_ENV !== 'development') return [];
    return [{ source: '/api/:path*', destination: 'http://127.0.0.1:8080/api/:path*' }];
  }
};

export default config;
