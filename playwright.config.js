import { defineConfig, devices } from "@playwright/test";

// End-to-end tests: run the real app in Chromium against the Firebase emulators.
// Start with `npm run test:e2e` (it starts the emulators first).
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 45000,
  expect: { timeout: 10000 },
  workers: 1,               // tests share one emulator database
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:5510",
    serviceWorkers: "block", // always test the latest files, not a cached copy
    trace: "retain-on-failure"
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"] } }
  ],
  webServer: {
    command: "node tests/support/static-server.js 5510",
    url: "http://127.0.0.1:5510/index.html",
    reuseExistingServer: false
  }
});
