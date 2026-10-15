import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  use: { baseURL: 'http://localhost:5179' },
  webServer: { command: 'npx vite --port 5179 --strictPort', url: 'http://localhost:5179/debug.html', reuseExistingServer: true },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    // 모바일 화면 폭 확인용 (엔진은 Chromium. 실제 iOS 사파리 한계는 기기에서 확인해야 함)
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
