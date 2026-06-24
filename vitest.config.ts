import { defineConfig } from "vitest/config";

// The pure betting/coin seams (convex/pool.ts cap helpers, convex/betting.ts
// computeBankroll) are unit-tested here. Edge-runtime matches the Convex
// function runtime (per convex/_generated/ai/guidelines.md) so backend modules
// import cleanly without a live deployment.
export default defineConfig({
  test: {
    environment: "edge-runtime",
    include: ["convex/**/*.test.ts"],
  },
});
