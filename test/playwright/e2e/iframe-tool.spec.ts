import { expect, test } from '@playwright/test'

import { dataCy, expectTaskResultMessage } from '../support/taskyon'

test.describe('iframe integration', () => {
  test('creates and uses a client tool through the iframe', async ({ page }) => {
    await page.goto('/clienttest')

    const frame = page.frameLocator('iframe')
    await frame.locator('body').waitFor()

    await frame.locator('body').evaluate(async () => {
      localStorage.clear()
      sessionStorage.clear()

      const databases = await indexedDB.databases()
      await Promise.all(
        databases.map(
          (db) =>
            new Promise<void>((resolve, reject) => {
              if (!db.name) {
                resolve()
                return
              }

              const request = indexedDB.deleteDatabase(db.name)
              request.onerror = () => reject(request.error)
              request.onsuccess = () => resolve()
              request.onblocked = () => resolve()
            }),
        ),
      )
    })

    await expect(dataCy(page, 'client-ready')).toContainText('client ready')
    await frame.getByRole('button', { name: 'Open Sidebar' }).click()
    await expect(frame.getByText(/profile: client_test_page/)).toBeVisible()

    await page.waitForTimeout(2_000)
    await page.getByRole('button', { name: 'Execute Client Test Function' }).click()

    await expect(
      frame.locator('.message').filter({ hasText: 'strating to test the client' }),
    ).toBeVisible({
      timeout: 60_000,
    })

    await expect(page.locator('#output')).toContainText('cypresstest function', {
      timeout: 60_000,
    })

    const taskResultText =
      (await dataCy(page, 'task-result').textContent({ timeout: 60_000 })) ?? ''
    await expectTaskResultMessage(taskResultText)
  })
})
