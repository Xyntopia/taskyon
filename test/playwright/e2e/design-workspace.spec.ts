import { expect, test } from '@playwright/test'

test.describe('design workspace', () => {
  test('opens, renders, and reruns the local AI workstation example', async ({ page }) => {
    const pageErrors: string[] = []
    const relevantConsoleErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
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
    await expect(page).toHaveURL(/\/design\/ai-workstation\/revision\//)
    await expect(page.getByText('Building the design workspace…', { exact: true })).toBeHidden()

    const resultCard = page.locator('.result-card')
    const evaluationStatus = resultCard.locator('.panel-summary')
    await expect(evaluationStatus).toHaveText(/^Artifact /)

    await page.getByRole('tab', { name: 'Result', exact: true }).click()
    await expect(resultCard.locator('.q-banner.bg-negative')).toHaveCount(0)

    await page.getByRole('tab', { name: 'Visual', exact: true }).click()
    const visualization = page.frameLocator('iframe[title="Design result visualization"]')
    await expect(visualization.getByText('Waiting for the evaluated design…')).toBeHidden()
    await expect(visualization.getByLabel('Generated AI workstation')).toBeVisible()

    const nextArtifact = evaluationStatus.evaluate(
      (element) =>
        new Promise<void>((resolve) => {
          const observer = new MutationObserver(() => {
            if (!element.textContent?.startsWith('Artifact ')) return
            observer.disconnect()
            resolve()
          })
          observer.observe(element, { childList: true, subtree: true, characterData: true })
        }),
    )
    await page.getByRole('button', { name: 'Run', exact: true }).click()
    await nextArtifact
    await expect(visualization.getByLabel('Generated AI workstation')).toBeVisible()

    await page.getByRole('tab', { name: 'Result', exact: true }).click()
    await expect(resultCard.locator('.q-banner.bg-negative')).toHaveCount(0)
    expect(pageErrors).toEqual([])
    expect(relevantConsoleErrors).toEqual([])
  })
})
