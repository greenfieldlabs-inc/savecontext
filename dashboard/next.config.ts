import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Local dashboard - reads from ~/.savecontext/data/savecontext.db
  output: 'standalone',
  outputFileTracingRoot: path.join(process.cwd(), ".."),
};

export default nextConfig;
