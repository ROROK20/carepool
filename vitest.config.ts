import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    exclude: ["tests/e2e/**", "node_modules/**"],
    pool: "forks",
    testTimeout: 60_000,
    env: {
      CAREPOOL_PROVIDER: "mock",
      CAREPOOL_OFFLINE: "1",
      DATABASE_PATH: ":memory:",
    },
  },
});
