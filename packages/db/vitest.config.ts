import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // The tenancy tests share one Postgres schema and clean fixtures by slug
    // prefix, so they must not interleave.
    fileParallelism: false,
    testTimeout: 20_000,
    setupFiles: ["./vitest.setup.ts"],
  },
});
