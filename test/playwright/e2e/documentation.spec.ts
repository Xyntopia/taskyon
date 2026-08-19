import { expect, test } from '@playwright/test'

test.describe('documentation page', () => {
  test('shows progress while building a documentation base', async ({ page }) => {
    await page.route('**/docs/user/index.md', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 600))
      await route.continue()
    })

    const navigation = page.goto('/docs/taskyon/openapi/taskyon-peer-api')
    await expect(page.getByText('Building documentation...', { exact: true })).toBeVisible()
    await navigation
    await expect(page.getByText('Building documentation...', { exact: true })).toBeHidden()
    await expect(page.getByText('Taskyon Peer API', { exact: true }).first()).toBeVisible()
  })

  test('resolves links from the selected document and reports unknown routes', async ({ page }) => {
    await page.goto('/docs/taskyon')
    await expect(page).toHaveURL(/\/docs\/taskyon\/user\/index\.md$/)
    await expect(page.locator('.ty-markdown h1')).toHaveText('Taskyon Documentation')

    const gettingStarted = page.getByRole('link', {
      name: 'Run Taskyon and configure a provider',
    })
    const destination = await gettingStarted.evaluate((link: HTMLAnchorElement) => link.href)
    expect(new URL(destination).pathname).toBe('/docs/taskyon/user/getting-started.md')

    await gettingStarted.click()
    await expect(page).toHaveURL(/\/docs\/taskyon\/user\/getting-started\.md$/)
    await expect(page.locator('.ty-markdown h1')).toHaveText('Getting Started')

    await page.goto('/docs/taskyon/missing.md')
    await expect(
      page.getByText('Documentation page not found: missing.md.', { exact: true }),
    ).toBeVisible()
    await expect(page.locator('.ty-markdown h1')).toHaveCount(0)
  })

  test('initializes Taskyon with persisted history without FRP readiness timeouts', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem('currentProfile', '__q_strn|docs-readiness-test')
      localStorage.setItem(
        'uiProfile:docs-readiness-test',
        `__q_strn|${JSON.stringify({ version: 27, chatHistory: ['missing-test-task'] })}`,
      )
    })
    const readinessErrors: string[] = []
    page.on('pageerror', (error) => {
      if (error.message.includes('Timeout after') && error.stack?.includes('frpBus.ts')) {
        readinessErrors.push(error.stack)
      }
    })

    await page.goto('/docs/taskyon')
    await expect(page.locator('.ty-markdown h1')).toHaveText('Taskyon Documentation')
    await page.waitForTimeout(6_000)

    expect(readinessErrors).toEqual([])
  })

  test('searches manifest documents and renders resolved OpenAPI schemas', async ({ page }) => {
    await page.goto('/docs/taskyon/user/index.md')
    await expect(page.locator('.ty-markdown h1')).toHaveText('Taskyon Documentation')

    const filter = page.getByPlaceholder('Filter docs')
    await filter.fill('task trees')
    await expect(page.getByText('Task Trees', { exact: true })).toBeVisible()
    await filter.fill('')
    await expect(page.getByText('Getting Started', { exact: true })).toBeVisible()

    await page.getByRole('link', { name: 'Understand task trees' }).click()
    await expect(page).toHaveURL(/\/docs\/taskyon\/user\/task-trees\.md$/)

    await page.goto('/docs/taskyon/openapi/taskyon-peer-api')
    await page.getByText('files.add', { exact: true }).first().click()
    const detail = page.locator('.openapi-view__detail')
    await expect(
      detail.getByText('Store a content-addressed file with the local Taskyon peer.', {
        exact: true,
      }),
    ).toBeVisible()

    const panels = detail.locator('.openapi-view__schema-panel')
    const requestPanel = panels.filter({ has: page.getByText('Request', { exact: true }) })
    const responsePanel = panels.filter({ has: page.getByText('200', { exact: true }) })
    await expect(detail.getByText('POST', { exact: true })).toBeVisible()
    await expect(detail.getByText('/frp/files.add', { exact: true })).toBeVisible()
    await expect(requestPanel).toContainText('file:')
    await expect(requestPanel).toContainText(
      'Browser File payload transferred over MessageChannel.',
    )
    await expect(responsePanel).toContainText('hash:')
    await expect(responsePanel).toContainText('name:')
    await expect(responsePanel).toContainText('mediaType:')
    await expect(responsePanel).toContainText('size:')
    await expect(detail.getByText('requestBody:', { exact: true })).toHaveCount(0)
    await expect(detail.getByText('definition:', { exact: true })).toHaveCount(0)
    await expect(detail.getByRole('button', { name: 'Copy entire object as JSON' })).toHaveCount(0)
    await expect(detail.locator('.openapi-view__schema-panel .q-field')).toHaveCount(0)

    await page.getByText('task.createChain', { exact: true }).first().click()
    const chainTree = page.locator('.openapi-view__detail .q-tree').filter({ hasText: 'tasks:' })
    await expect(chainTree).toContainText('tasks:')
    await expect(chainTree).toContainText('role:')

    const loading = page.getByText('Preparing JSON…', { exact: true })
    await page.locator('.openapi-view__header button').click()
    await expect(loading).toBeVisible()

    const rawJson = page.locator('.openapi-view__raw pre.raw-view')
    await expect(rawJson).toBeVisible()
    await expect(rawJson).toContainText('"openapi": "3.1.0"')
    await expect(page.locator('.openapi-view__raw .q-tree')).toHaveCount(0)
  })
})
