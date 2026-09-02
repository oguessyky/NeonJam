import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // youtubei.js is server-only; keep it out of the client/edge bundle.
  serverExternalPackages: ["youtubei.js"],
};

export default nextConfig;
