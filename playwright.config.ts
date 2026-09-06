import { defineConfig, devices } from '@playwright/test';

/* ═══════════════════════════════════════════════════════════════
   E2E config — drives an existing Chromium (revision matches the
   locally cached ms-playwright install, so no browser download) and
   auto-starts/stops the Vite dev server for the test run.
   ═══════════════════════════════════════════════════════════════ */

const IS_CI = !!process.env.CI;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: IS_CI,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  timeout: 60_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  /* Auto-start the dev server for the test run (and shut it down after). */
  webServer: {
    command: 'npx vite --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
