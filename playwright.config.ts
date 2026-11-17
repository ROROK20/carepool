import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run against a dev server in mock-provider, offline mode,
 * on a fresh database seeded with the fictional Nana Rosa household.
 * Port 3310 (never 3000 or 8002, which other local apps use).
 */
const PORT = Number(process.env.E2E_PORT ?? 3310);
const BASE_URL = `http://localhost:${PORT}`;
const DB = "./data/e2e.db";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  reporter: "list",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    navigationTimeout: 120_000,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: /mobile\.spec\.ts/ },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: {
    command: `rm -f ${DB} ${DB}-shm ${DB}-wal && npx tsx scripts/setup.ts --reset && npx next dev -p ${PORT}`,
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 300_000,
    env: {
      CAREPOOL_PROVIDER: "mock",
      CAREPOOL_OFFLINE: "1",
      DATABASE_PATH: DB,
    },
  },
});
