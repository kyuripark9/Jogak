import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  use: { baseURL: 'http://localhost:5179' },
  webServer: { command: 'npx vite --port 5179 --strictPort', url: 'http://localhost:5179/debug.html', reuseExistingServer: true },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    // Checks mobile screen width only (engine is Chromium; real iOS Safari limits must be checked on a device)
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
