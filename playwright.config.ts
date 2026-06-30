import { defineConfig, devices } from '@playwright/test'

const port = Number(process.env.PLAYWRIGHT_PORT ?? 9000)
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `https://127.0.0.1:${port}`
const startServer = process.env.PLAYWRIGHT_SKIP_WEB_SERVER !== '1'
const webServer = startServer
  ? {
      command: `COREPACK_HOME=/tmp/corepack TASKYON_FAST_DEV_BUILD=1 yarn dev --hostname 127.0.0.1 --port ${port}`,
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      ignoreHTTPSErrors: true,
    }
  : undefined

export default defineConfig({
  testDir: './test/playwright/e2e',
  outputDir: './test-results/playwright',
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  retries: process.env.CI ? 2 : 0,
  timeout: 120_000,
  expect: {
    timeout: 30_000,
  },
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ignoreHTTPSErrors: true,
  },
  ...(webServer ? { webServer } : {}),
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
