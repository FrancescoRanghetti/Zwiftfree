import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against a running stack (by default the Docker one: `docker compose up -d`).
 *
 *   npm run e2e                         # bundled Chromium (once: npx playwright install chromium)
 *   PW_CHANNEL=chrome npm run e2e       # or the installed Google Chrome
 *   E2E_BASE_URL=http://localhost:4200 npm run e2e   # against `npm start`
 *   SCREENSHOTS=1 npm run e2e           # also refresh the README screenshots in docs/screenshots
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e-report' }]],
  outputDir: 'e2e-results',
  use: {
    baseURL: process.env['E2E_BASE_URL'] ?? 'http://localhost:4280',
    locale: 'it-CH',
    timezoneId: 'Europe/Zurich',
    viewport: { width: 1366, height: 860 },
    colorScheme: 'dark',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], channel: process.env['PW_CHANNEL'] || undefined },
    },
  ],
});
