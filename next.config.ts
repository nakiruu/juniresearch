import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained production server at .next/standalone/server.js with only the
  // traced node_modules, so the Docker runtime image stays small. See Dockerfile.
  output: "standalone",
  // A Schwab OAuth redirect to the bare site root (a callback registered as https://<site>) would
  // otherwise hit "/" → "/research" and lose its one-time ?code=. Send it to the copy page instead;
  // Next passes the query string through unchanged. 307, never cached.
  async redirects() {
    return [
      { source: "/", has: [{ type: "query", key: "code" }], destination: "/schwab/callback", permanent: false },
      { source: "/", has: [{ type: "query", key: "error" }], destination: "/schwab/callback", permanent: false },
    ];
  },
};

export default nextConfig;
