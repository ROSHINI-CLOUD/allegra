import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against the real app and API.
 *
 * Locally this reuses `npm run dev` if it is already up, or starts it. Point
 * E2E_BASE_URL at a Vercel preview to run the same suite against a deployment.
 */
const baseURL = process.env.E2E_BASE_URL?.replace(/\/+$/, '') ?? 'http://localhost:5173';
const local = !process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: '.',
  outputDir: '../../output/playwright/results',
  // Real providers and real audio: keep runs serial so tests don't fight over bandwidth.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { outputFolder: '../../output/playwright/report', open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] }
  },
  projects: [
    { name: 'api', testMatch: /api\.spec\.ts/ },
    {
      name: 'desktop',
      testMatch: /(app|karaoke)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 860 } }
    },
    {
      name: 'mobile',
      testMatch: /mobile\.spec\.ts/,
      use: { ...devices['Pixel 7'], viewport: { width: 375, height: 812 } }
    }
  ],
  webServer: local
    ? {
        command: 'npm run dev',
        cwd: '../..',
        url: `${baseURL}/api/health`,
        reuseExistingServer: true,
        timeout: 180_000
      }
    : undefined
});
