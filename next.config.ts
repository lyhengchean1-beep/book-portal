import type { NextConfig } from "next";

// Next.js aborts a Server Action when the forwarded host does not match the
// Origin header. Any tunnel or proxy hostname has to be declared here.
// Host only - no scheme, no trailing slash, comma-separated for several.
const forwardedHosts = (process.env.ALLOWED_FORWARDED_HOSTS ?? "")
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean);

// Next.js buffers the body of any request reachable through middleware
// (this app has one, for auth - src/middleware.ts) up to a size limit that
// defaults to 10MB, completely independent of MAX_UPLOAD_MB below. Past
// that, the body is silently truncated mid-multipart-boundary rather than
// rejected, which is what turns into "Failed to parse body as FormData" in
// the app log and a generic "check your connection" toast in the browser -
// nothing about it names the real limit. Deriving this from MAX_UPLOAD_MB
// keeps the two from drifting apart again; +10MB covers the multipart
// overhead of the title/author fields and the page-one thumbnail riding
// alongside the PDF in the same upload.
const maxUploadMb = Number(process.env.MAX_UPLOAD_MB ?? 50);
const middlewareBodyLimitBytes = (maxUploadMb + 10) * 1024 * 1024;

const nextConfig: NextConfig = {
  // googleapis is CommonJS and must not be bundled into the server chunks.
  serverExternalPackages: ["googleapis"],
  experimental: {
    serverActions: {
      allowedOrigins: ["localhost:3000", ...forwardedHosts],
    },
    middlewareClientMaxBodySize: middlewareBodyLimitBytes,
  },
};

export default nextConfig;