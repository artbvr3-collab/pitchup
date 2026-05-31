import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  // Layer 10 deploy: emit a self-contained server bundle (`.next/standalone`)
  // so the production Docker image ships only the traced runtime deps — no
  // full node_modules, no pnpm at runtime. The Dockerfile copies
  // `.next/standalone` + `.next/static` + `public` into a slim runner.
  output: "standalone",
};

export default nextConfig;
