/**
 * A build identifier shared by the server and the client.
 *
 * The service worker names its caches after this, so a deploy produces a different
 * worker URL, which installs a new worker, which drops the previous build's caches.
 * Without it the worker keeps serving the last build's HTML, and that HTML references
 * asset hashes that no longer exist — an unstyled page for anyone who used the app
 * before the deploy.
 */
const buildId =
  process.env.SOURCE_COMMIT?.slice(0, 12) ??
  process.env.GITHUB_SHA?.slice(0, 12) ??
  `dev-${Date.now().toString(36)}`;

/** @type {import('next').NextConfig} */
const nextConfig = {
  generateBuildId: () => buildId,
  env: { NEXT_PUBLIC_BUILD_ID: buildId },
  // Standalone output so the production container is ~150 MB instead of dragging
  // node_modules along. Nothing about this deployment needs Vercel.
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  // The shared package is compiled from the monorepo, so Next has to transpile it.
  // Deliberately *not* in optimizePackageImports: that rewrite assumes an ESM
  // barrel file and breaks a CommonJS package's client/server boundaries.
  transpilePackages: ['@mk/shared'],
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // The POS asks for the camera (QR scanning) and location (geofenced punch).
          { key: 'Permissions-Policy', value: 'camera=(self), geolocation=(self), microphone=()' },
        ],
      },
      {
        /*
         * HTML documents must be revalidated, never served stale.
         *
         * Next's default for a revalidating page is
         * `s-maxage=120, stale-while-revalidate=31535880` — and that second number is a
         * YEAR. A returning visitor therefore gets the previous build's HTML instantly,
         * which references asset hashes that no longer exist after a deploy, and the
         * page renders with no CSS at all. One deploy, every returning visitor, one
         * broken page each.
         *
         * `max-age=0, must-revalidate` costs a conditional request that answers 304 in a
         * few bytes. `s-maxage` is kept so a CDN in front can still absorb the load.
         * Hashed assets under /_next/static are excluded — those are content-addressed
         * and genuinely immutable.
         */
        source: '/:path*',
        missing: [{ type: 'header', key: 'next-router-prefetch' }],
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate, s-maxage=120' },
        ],
      },
      {
        source: '/_next/static/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        /* The worker itself must never be cached, or a deploy cannot replace it. */
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ];
  },
};

export default nextConfig;
