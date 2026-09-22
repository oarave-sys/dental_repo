/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  /**
   * Native modules must not be bundled into the server build.
   *
   * @node-rs/argon2 ships a platform-specific .node binary and the Prisma
   * driver adapters open real sockets. Next.js tracing cannot bundle either
   * correctly, and on a serverless deploy the failure shows up at runtime as a
   * missing binding rather than at build time — so they are externalised.
   */
  serverExternalPackages: ['@node-rs/argon2', '@prisma/adapter-pg', 'pg'],

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // Clinical descriptions must never leak to a third party in a
          // referrer, and the app is never framed.
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
    ]
  },
}

export default nextConfig
