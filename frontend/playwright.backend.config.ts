import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/backend',
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:18446/event-confirm/',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE },
  },
  webServer: {
    command: 'npm run dev -- --port 18446 --strictPort',
    url: 'http://127.0.0.1:18446/event-confirm/',
    reuseExistingServer: false,
  },
  reporter: [['list'], ['junit', { outputFile: 'reports/backend-browser.xml' }]],
});
