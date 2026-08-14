import { defineConfig, devices } from '@playwright/test';

const proGateUrl = process.env.RR3_PRO_URL ?? 'http://127.0.0.1:4387';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  fullyParallel: true,
  workers: process.env.RR3_PRO_GATE === '1' ? 1 : undefined,
  reporter: 'line',
  use: {
    trace: 'retain-on-failure',
  },
  webServer: process.env.RR3_PRO_GATE === '1' ? {
    command: 'pnpm --filter @rr3/pro build && node scripts/serve-pro-build.mjs',
    url: proGateUrl,
    reuseExistingServer: false,
    timeout: 120_000,
  } : undefined,
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
});
