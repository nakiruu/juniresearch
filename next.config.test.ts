import { describe, it, expect } from "vitest";
import nextConfig from "./next.config";

describe("next.config redirects", () => {
  it("sends a Schwab OAuth redirect on the site root (code or error) to /schwab/callback, temporarily", async () => {
    const rules = await nextConfig.redirects!();
    for (const key of ["code", "error"]) {
      expect(rules).toContainEqual({ source: "/", has: [{ type: "query", key }], destination: "/schwab/callback", permanent: false });
    }
  });
});
