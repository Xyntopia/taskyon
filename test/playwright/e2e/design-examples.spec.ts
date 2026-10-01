import { expect, test, type Page } from '@playwright/test'

const examples = [
  { projectId: 'ai-workstation', title: 'Ai Workstation' },
  { projectId: 'mission-drone', title: 'Mission Drone' },
  { projectId: 'mars-rover', title: 'Mars Rover' },
  { projectId: 'satellite', title: 'Satellite' },
  { projectId: 'home-battery', title: 'Home Battery' },
] as const

const dismissProviderPrompt = async (page: Page) => {
  await page.addLocatorHandler(
    page.getByRole('dialog').filter({ hasText: 'Connect to taskyon?' }),
    async (dialog) => await dialog.getByRole('button', { name: 'Cancel' }).click(),
  )
}

const openExample = async (page: Page, projectId: string, title: string) => {
  await page.goto(`/design/${projectId}/main`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  })
  await expect(page.getByRole('tab', { name: 'Graph', exact: true })).toBeVisible({
    timeout: 90_000,
  })
  await expect(page.locator('.design-toolbar .text-subtitle1')).toHaveText(title)
  await expect(page.getByText(/Missing DAG node record/)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Reload project' }).locator('svg')).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Graph', exact: true }).locator('svg')).toBeVisible()
}

const assertResult = (projectId: string, value: unknown) => {
  expect(value).toBeTruthy()
  expect(typeof value).toBe('object')
  const recommendation = (value as { recommendation?: Record<string, unknown> }).recommendation
  expect(recommendation).toBeTruthy()

  if (projectId === 'ai-workstation') {
    expect(String(recommendation?.configuration ?? '')).not.toBe('')
    expect(Number(recommendation?.usableVramGb)).toBeGreaterThan(0)
    expect(Number(recommendation?.estimatedPriceUsd)).toBeGreaterThan(0)
    return String(recommendation?.configuration)
  }

  expect(String(recommendation?.name ?? '')).not.toBe('')
  expect(Number(recommendation?.capacity)).toBeGreaterThan(0)
  expect(Number(recommendation?.costUsd)).toBeGreaterThan(0)
  expect(Number(recommendation?.performance)).toBeGreaterThan(0)
  return String(recommendation?.name)
}

const runExample = async (page: Page, projectId: string) => {
  const runTab = page.getByRole('tab', { name: 'Run', exact: true })
  const visualTab = page.getByRole('tab', { name: 'Visual', exact: true })
  const runButton = page.getByRole('button', { name: 'Run', exact: true })

  await runTab.click()
  await expect(page.locator('.run-panel .q-slider').first()).toBeVisible()

  await visualTab.click()
  await runButton.click()
  await expect(runTab).toHaveAttribute('aria-selected', 'true', { timeout: 60_000 })
  await expect(page.locator('.run-panel .q-banner.bg-negative')).toHaveCount(0)

  const runStatus = page.locator('.run-panel .text-caption')
  const firstRunStatus = await runStatus.innerText()
  const firstResultText = await page.locator('.run-panel .result-output').innerText()
  const firstResult = JSON.parse(firstResultText) as unknown
  const displayName = assertResult(projectId, firstResult)

  await visualTab.click()
  const frame = page.frameLocator('iframe[title="Design result visualization"]')
  await expect(frame.locator('body')).toContainText(displayName)

  await runButton.click()
  await expect(runTab).toHaveAttribute('aria-selected', 'true', { timeout: 60_000 })
  await expect.poll(() => runStatus.innerText()).not.toBe(firstRunStatus)
  await expect(page.locator('.run-panel .result-output')).not.toHaveText('')

  const secondResultText = await page.locator('.run-panel .result-output').innerText()
  const secondResult = JSON.parse(secondResultText) as unknown
  expect(assertResult(projectId, secondResult)).toBe(displayName)

  await visualTab.click()
  await expect(frame.locator('body')).toContainText(displayName)
}

test.describe('bundled design example regressions', () => {
  for (const example of examples) {
    test(`${example.title} exposes parameters and survives an identical rerun`, async ({
      page,
    }) => {
      await dismissProviderPrompt(page)
      await openExample(page, example.projectId, example.title)
      await runExample(page, example.projectId)
    })
  }

  test('home battery remains loadable after opening another bundled graph', async ({ page }) => {
    test.setTimeout(180_000)
    await dismissProviderPrompt(page)

    const sequence = [examples[4], examples[1], examples[4]]
    for (const example of sequence) {
      await openExample(page, example.projectId, example.title)
    }
  })
})
