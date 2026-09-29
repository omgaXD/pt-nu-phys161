import { defineConfig, devices } from '@playwright/test';
import { E2E_ROOT, PORT } from './e2e/paths';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 1000 } } }],
  webServer: {
    command: `node e2e/prepare.mjs && vite dev --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { PT_ROOT: E2E_ROOT, PT_STORE: 'fs' },
  },
});
