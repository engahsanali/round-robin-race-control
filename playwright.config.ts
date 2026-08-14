import { defineConfig, devices } from '@playwright/test';

const proGateUrl = process.env.RR3_PRO_URL ?? 'http://127.0.0.1:4387';
const meetGateUrl = process.env.RR3_MEET_URL ?? 'http://127.0.0.1:4399';
const meetGate = process.env.RR3_MEET_GATE === '1' || process.env.RR3_MEET_WORKBOOK_GATE === '1';
const proGate = process.env.RR3_PRO_GATE === '1';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  fullyParallel: !(meetGate || proGate),
  workers: meetGate || proGate ? 1 : undefined,
  reporter: 'line',
  use: {
    trace: 'retain-on-failure',
  },
  webServer: meetGate ? {
    command: 'pnpm --filter @rr3/meet build && node scripts/verify-meet-build.mjs && node scripts/serve-meet-build.mjs',
    url: `${meetGateUrl}/__rr3_health`,
    reuseExistingServer: false,
    timeout: 120_000,
  } : proGate ? {
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
