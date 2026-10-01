import { expect, test } from '@playwright/test'

test.describe('design workspace', () => {
  test('opens, renders, and reruns the local AI workstation example', async ({ page }) => {
    const pageErrors: string[] = []
    const relevantConsoleErrors: string[] = []
    let providerPrompts = 0
    await page.addLocatorHandler(
      page.getByRole('dialog').filter({ hasText: 'Connect to taskyon?' }),
      async (dialog) => {
        providerPrompts += 1
        await dialog.getByRole('button', { name: 'Cancel' }).click()
      },
    )
    page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message))
    page.on('console', (message) => {
      if (
        message.type() === 'error' &&
        /process is not defined|could not be cloned/i.test(message.text())
      ) {
        relevantConsoleErrors.push(message.text())
      }
    })

    await page.goto('/')
    await page.getByRole('button', { name: 'Local AI workstation', exact: true }).click()
    await expect(page).toHaveURL(/\/design\/ai-workstation\/main$/, { timeout: 60_000 })
    await expect(page.getByText('Building the design workspace…', { exact: true })).toBeHidden()
    await expect(page.getByRole('tab', { name: 'Graph', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(page.getByRole('img')).toBeVisible()

    await page.getByRole('button', { name: 'Run', exact: true }).click()
    const runStatus = page.locator('.run-panel .text-caption')
    await expect(runStatus).toHaveText(/^\s*Run .+ · completed · 3 artifacts\s*$/)
    await expect(page.locator('.run-panel .result-output')).toContainText('"recommendation"')
    await expect(page.locator('.run-panel .q-banner.bg-negative')).toHaveCount(0)
    const firstRunStatus = await runStatus.innerText()

    const paramsInput = page.getByLabel('Constant parameters (JSON)')
    const params = JSON.parse(await paramsInput.inputValue()) as Record<string, unknown>
    await paramsInput.fill(JSON.stringify({ ...params, budgetUsd: 8_000 }, null, 2))
    await page.getByRole('button', { name: 'Run', exact: true }).click()
    await expect.poll(() => runStatus.innerText()).not.toBe(firstRunStatus)
    await expect(runStatus).toHaveText(/^\s*Run .+ · completed · 3 artifacts\s*$/)
    await expect(page.locator('.run-panel .q-banner.bg-negative')).toHaveCount(0)
    expect(pageErrors).toEqual([])
    expect(relevantConsoleErrors).toEqual([])
    expect(providerPrompts).toBe(0)
  })

  test('opens the mission drone example with its rendered design', async ({ page }) => {
    page.on('console', (message) => {
      if (message.text().startsWith('design-load:')) console.log(message.text())
    })
    let providerPrompts = 0
    await page.addLocatorHandler(
      page.getByRole('dialog').filter({ hasText: 'Connect to taskyon?' }),
      async (dialog) => {
        providerPrompts += 1
        await dialog.getByRole('button', { name: 'Cancel' }).click()
      },
    )
    await page.goto('/')
    await page.getByRole('button', { name: 'Mission drone', exact: true }).click()

    await expect(page).toHaveURL(/\/design\/mission-drone\/main$/)
    await expect(page.getByRole('tab', { name: 'Graph', exact: true })).toBeVisible()
    await expect(page.getByTitle('Design result visualization')).toBeVisible()
    expect(providerPrompts).toBe(0)
  })
})
