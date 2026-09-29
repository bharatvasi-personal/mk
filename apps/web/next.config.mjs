/** @type {import('next').NextConfig} */
const nextConfig = {
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
    ];
  },
};

export default nextConfig;
