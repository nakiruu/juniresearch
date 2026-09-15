import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained production server at .next/standalone/server.js with only the
  // traced node_modules, so the Docker runtime image stays small. See Dockerfile.
  output: "standalone",
};

export default nextConfig;
