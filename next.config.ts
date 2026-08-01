import type { NextConfig } from "next";

// Next.js aborts a Server Action when the forwarded host does not match the
// Origin header. Any tunnel or proxy hostname has to be declared here.
// Host only - no scheme, no trailing slash, comma-separated for several.
const forwardedHosts = (process.env.ALLOWED_FORWARDED_HOSTS ?? "")
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  // googleapis is CommonJS and must not be bundled into the server chunks.
  serverExternalPackages: ["googleapis"],
  experimental: {
    serverActions: {
      allowedOrigins: ["localhost:3000", ...forwardedHosts],
    },
  },
};

export default nextConfig;