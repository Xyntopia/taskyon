import { defineConfig, devices } from '@playwright/test'

const port = Number(process.env.PLAYWRIGHT_PORT ?? 9000)
const localProduction = process.env.PLAYWRIGHT_LOCAL_PRODUCTION === '1'
const baseURL =
  process.env.PLAYWRIGHT_BASE_URL ?? `${localProduction ? 'http' : 'https'}://127.0.0.1:${port}`
const supportedBrowsers = ['chromium', 'firefox'] as const
type BrowserName = (typeof supportedBrowsers)[number]

const browserNames = (
  process.env.PLAYWRIGHT_BROWSERS ??
  process.env.PLAYWRIGHT_BROWSER ??
  'chromium'
)
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean)
  .map((name) => {
    if (!supportedBrowsers.includes(name as BrowserName)) {
      throw new Error(
        `Unsupported Playwright browser "${name}". Use: ${supportedBrowsers.join(', ')}.`,
      )
    }
    return name as BrowserName
  })

if (browserNames.length === 0) {
  throw new Error(`PLAYWRIGHT_BROWSERS must list: ${supportedBrowsers.join(', ')}.`)
}
const startServer = process.env.PLAYWRIGHT_SKIP_WEB_SERVER !== '1'
const webServer = startServer
  ? {
      command: localProduction
        ? `yarn serve:spa dist/spa ${port} 127.0.0.1`
        : `COREPACK_HOME=/tmp/corepack TASKYON_FAST_DEV_BUILD=1 yarn dev --hostname 127.0.0.1 --port ${port}`,
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
  projects: browserNames.map((name) => ({
    name,
    use: { ...(name === 'firefox' ? devices['Desktop Firefox'] : devices['Desktop Chrome']) },
  })),
})
