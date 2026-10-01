import { expect, test, type Page } from '@playwright/test'

const runtimeTimeoutWindowMs = 35_000

const trackRuntimeTimeouts = (page: Page) => {
  const timeouts: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error' && message.text().includes('Request timed out')) {
      timeouts.push(message.text())
    }
  })
  page.on('pageerror', (error) => {
    const text = error.stack ?? error.message
    if (text.includes('Request timed out')) timeouts.push(text)
  })
  return timeouts
}

const waitForRuntimeTimeoutWindow = async (page: Page, startedAtMs: number) => {
  const remaining = runtimeTimeoutWindowMs - (Date.now() - startedAtMs)
  if (remaining > 0) await page.waitForTimeout(remaining)
}

test.describe('design workspace', () => {
  test('opens, renders, and reruns the local AI workstation example', async ({ page }) => {
    const pageErrors: string[] = []
    const relevantConsoleErrors: string[] = []
    let providerPrompts = 0
    const runtimeTimeouts = trackRuntimeTimeouts(page)
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
    const bootedAtMs = Date.now()
    await page.getByRole('button', { name: 'Local AI workstation', exact: true }).click()
    await expect(page).toHaveURL(/\/design\/ai-workstation\/main$/, { timeout: 60_000 })
    await expect(page.getByText('Building the design workspace…', { exact: true })).toBeHidden()
    await expect(page.getByRole('tab', { name: 'Graph', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(page.getByRole('img', { name: 'Graph visualization' })).toBeVisible()

    await page.getByRole('button', { name: 'Run', exact: true }).click()
    const runStatus = page.locator('.run-panel .text-caption')
    await expect(runStatus).toHaveText(/^\s*Run .+ · completed · 3 artifacts\s*$/)
    await expect(page.locator('.run-panel .result-output')).toContainText('"recommendation"')
    await expect(page.locator('.run-panel .q-banner.bg-negative')).toHaveCount(0)
    const firstResult = await page.locator('.run-panel .result-output').innerText()

    await page.getByRole('tab', { name: 'Visual', exact: true }).click()
    await page.getByRole('button', { name: 'Run', exact: true }).click()
    await expect(page.getByRole('tab', { name: 'Run', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(page.locator('.run-panel .result-output')).toHaveText(firstResult)
    await expect(runStatus).toHaveText(/^\s*Run .+ · completed · 3 artifacts\s*$/)
    await expect(page.locator('.run-panel .q-banner.bg-negative')).toHaveCount(0)
    expect(pageErrors).toEqual([])
    expect(relevantConsoleErrors).toEqual([])
    expect(providerPrompts).toBe(0)
    await waitForRuntimeTimeoutWindow(page, bootedAtMs)
    expect(runtimeTimeouts).toEqual([])
  })

  test('opens the mission drone example with its rendered design', async ({ page }) => {
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
    const visualizationPanel = page.locator('.q-tab-panel').filter({
      has: page.getByTitle('Design result visualization'),
    })
    const visualizationFrame = page.getByTitle('Design result visualization')
    await expect(visualizationFrame).toBeVisible()
    await expect
      .poll(async () => {
        const [panelBox, frameBox] = await Promise.all([
          visualizationPanel.boundingBox(),
          visualizationFrame.boundingBox(),
        ])
        return panelBox && frameBox ? Math.abs(panelBox.height - frameBox.height) : Infinity
      })
      .toBeLessThanOrEqual(1)
    expect(providerPrompts).toBe(0)
  })
})
