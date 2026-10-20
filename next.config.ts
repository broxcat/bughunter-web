import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // BullMQ / ioredis are Node-only native-ish deps; keep them out of the bundle.
  serverExternalPackages: ["bullmq", "ioredis"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
