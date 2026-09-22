import type { NextConfig } from "next";

/**
 * The browser only ever talks to this origin. /api/* is proxied to the Express
 * backend, so the session cookie is first-party (works in Safari/Chrome without
 * third-party cookies) and no CORS round-trips are needed in production.
 */
const BACKEND_URL = (process.env.BACKEND_URL ?? "http://localhost:4000").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  transpilePackages: ["@preptrace/shared"],
  poweredByHeader: false,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${BACKEND_URL}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
