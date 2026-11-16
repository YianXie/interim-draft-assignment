import { defineConfig, devices } from "@playwright/test";

// INTERIM_PORT moves the test server off 4173, so the tests can run while the demo is open: INTERIM_PORT=4174 npm run check
const ORIGIN = `http://127.0.0.1:${Number(process.env.INTERIM_PORT) || 4173}`;

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.mjs",
  fullyParallel: true,
  reporter: "list",
  use: { baseURL: ORIGIN },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run serve",
    url: ORIGIN,
    reuseExistingServer: false,
  },
});
