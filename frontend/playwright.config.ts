import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:18446/event-confirm/',
    viewport: { width: 1440, height: 1000 },
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev:mock',
    url: 'http://127.0.0.1:18446/event-confirm/',
    reuseExistingServer: !process.env.CI,
  },
  reporter: [['list'], ['junit', { outputFile: 'reports/browser.xml' }]],
});
