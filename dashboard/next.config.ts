import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Local dashboard - reads from ~/.savecontext/data/savecontext.db
  output: 'standalone',
  // Native modules must be external to avoid Turbopack hashing
  serverExternalPackages: ['better-sqlite3'],
};

export default nextConfig;
