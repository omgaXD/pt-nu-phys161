import { defineConfig, devices } from '@playwright/test';
import { BASE, E2E_STATIC, PORT } from './e2e/paths';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}${BASE}/`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 1000 } } }],
  webServer: {
    // The real static build (not the dev server), served under a sub-path.
    command: `node e2e/prepare.mjs && vite build && vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}${BASE}/`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: { BASE_PATH: BASE, PT_QUIZ_ASSETS: E2E_STATIC },
  },
});
