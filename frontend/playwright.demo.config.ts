import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/demo',
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:18447/event-confirm/',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE },
  },
  webServer: {
    command: 'npm run preview -- --port 18447 --strictPort',
    url: 'http://127.0.0.1:18447/event-confirm/',
    reuseExistingServer: false,
  },
  reporter: [['list'], ['junit', { outputFile: 'reports/demo.xml' }]],
});
