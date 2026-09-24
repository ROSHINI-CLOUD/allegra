import path from 'node:path';
import type { NextConfig } from 'next';

const monorepoRoot = path.join(import.meta.dirname, '..', '..');

const config: NextConfig = {
  reactStrictMode: true,
  // Windows resolves localhost to ::1, so the app is routinely opened on
  // 127.0.0.1. Without this, dev blocks its own assets and the page renders blank.
  allowedDevOrigins: ['127.0.0.1'],
  // This repo already has AGENTS.md and CLAUDE.md written by hand at the root.
  agentRules: false,
  // packages/shared is imported by both apps; let the bundler read outside apps/web.
  turbopack: { root: monorepoRoot },
  // Local dev only: same-origin /api → the Express dev server. On Vercel the
  // Express app is a function at /api (see vercel.json), so nothing is proxied.
  async rewrites() {
    if (process.env.NODE_ENV !== 'development') return [];
    return [
      { source: '/api/:path*', destination: 'http://127.0.0.1:8080/api/:path*' },
      // MCP OAuth discovery lives at the site root (see vercel.json for production).
      { source: '/.well-known/oauth-protected-resource/:path*', destination: 'http://127.0.0.1:8080/.well-known/oauth-protected-resource/:path*' },
      { source: '/.well-known/oauth-protected-resource', destination: 'http://127.0.0.1:8080/.well-known/oauth-protected-resource' },
      { source: '/.well-known/oauth-authorization-server', destination: 'http://127.0.0.1:8080/.well-known/oauth-authorization-server' }
    ];
  },
  // No Content-Security-Policy here on purpose: this app leans on WebGL shaders, Convex,
  // Google OAuth redirects, external artwork/CDN images and Next's own inline hydration
  // scripts, and getting a CSP right for all of that needs live browser verification. A
  // broken CSP (blank page, broken auth, broken audio) is worse than no CSP — tracked
  // separately rather than shipped unverified.
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' }
        ]
      }
    ];
  }
};

export default config;
