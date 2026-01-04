import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Local dashboard - reads from ~/.savecontext/data/savecontext.db
  output: 'standalone',
};

export default nextConfig;
