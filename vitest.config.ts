import { defineConfig } from "vitest/config";

// Our tests live under src/ and (for CLI-wrapper coverage) under
// scripts/. The cloned benchmark repos under repos/ ship their own
// test suites — Vitest must not pick those up, or it tries to run
// hono's and httpx's test trees with our config.
export default defineConfig({
  test: {
    include: [
      "src/**/*.test.{ts,tsx}",
      "scripts/**/*.test.{ts,tsx}",
    ],
    exclude: ["node_modules", "dist", "repos", "runs"],
  },
});
