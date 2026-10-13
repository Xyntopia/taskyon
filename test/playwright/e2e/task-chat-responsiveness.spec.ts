import { expect, test } from '@playwright/test'

for (const width of [390, 1280]) {
  test(`submitted messages and expandable previews at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/task-chat-responsiveness-test')
    const input = page.getByRole('textbox')
    await input.fill('Show my message immediately')
    await input.press('Enter')
    const pendingMessage = page.locator(
      '[data-cy="taskyon-chat-thread"] [data-cy="pending-chat-message"]',
    )
    await expect(pendingMessage).toContainText('Show my message immediately')
    await expect(page.locator('.create-tasks [data-cy="pending-chat-message"]')).toHaveCount(0)
    await expect(page.getByText('Sending…')).toHaveCount(0)
    await expect(page.getByText('Creation is waiting')).toBeVisible()
    await input.fill('I can still type')
    await page.getByRole('button', { name: 'Confirm creation' }).click()
    await expect(pendingMessage).toHaveCount(0)
    await expect(page.locator('[data-cy="taskyon-chat-thread"]')).toContainText(
      'Show my message immediately',
    )
    await page.getByRole('button', { name: 'Open tool example' }).click()
    const row = page.locator('[data-task-id="fixture-call"]')
    await expect(row).toContainText('fixtureTool')
    await expect(row).toContainText('42')
    await expect(row.locator('.task-content-view')).toHaveCount(0)
    await row.getByRole('button').click()
    await expect(row.locator('.task-content-view')).toHaveCount(2)
    await expect(page.getByText('A visible assistant summary')).toBeVisible()
  })
}

test('submitting a message re-pins the shared chat to the bottom', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/task-chat-responsiveness-test')
  await page.getByRole('button', { name: 'Open tool example' }).click()

  const thread = page.locator('.task-chat-window__thread')
  await thread.evaluate((element) => {
    element.style.height = '120px'
    element.style.flex = '0 0 120px'
    element.scrollTop = 0
    element.dispatchEvent(new Event('scroll'))
  })
  await expect
    .poll(() =>
      thread.evaluate(
        (element) =>
          element.scrollHeight > element.clientHeight &&
          element.scrollTop < element.scrollHeight / 2,
      ),
    )
    .toBe(true)

  const input = page.getByRole('textbox')
  await input.fill('Keep the reply in view')
  await input.press('Enter')
  await expect(page.getByText('Creation is waiting')).toBeVisible()
  await expect
    .poll(() =>
      thread.evaluate(
        (element) => element.scrollHeight - element.scrollTop - element.clientHeight <= 24,
      ),
    )
    .toBe(true)
})
test('streamed assistant text keeps the shared chat pinned to the newest words', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/task-chat-responsiveness-test')
  await page.getByRole('button', { name: 'Open tool example' }).click()
  const thread = page.locator('.task-chat-window__thread')
  await thread.evaluate((element) => {
    element.style.height = '140px'
    element.style.flex = '0 0 140px'
    element.scrollTop = element.scrollHeight
    element.dispatchEvent(new Event('scroll'))

    const probe = { maxDistance: 0, samples: 0 }
    Object.assign(window, { __taskyonChatScrollProbe: probe })
    const observer = new MutationObserver(() => {
      requestAnimationFrame(() => {
        probe.samples += 1
        probe.maxDistance = Math.max(
          probe.maxDistance,
          element.scrollHeight - element.scrollTop - element.clientHeight,
        )
      })
    })
    observer.observe(element, { childList: true, subtree: true, characterData: true })
  })

  await page.getByRole('button', { name: 'Stream assistant response' }).click()
  const liveProgress = page.locator('[data-cy="taskyon-live-progress"]')
  await expect(liveProgress).toContainText('Stream chunk 5', { timeout: 30_000 })
  await thread.evaluate((element) => {
    element.scrollTop = 0
    element.dispatchEvent(new Event('scroll'))
  })
  await expect
    .poll(() =>
      thread.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight),
    )
    .toBeLessThanOrEqual(24)
  await expect(liveProgress).toContainText('Stream chunk 23', {
    timeout: 30_000,
  })
  await expect
    .poll(() =>
      thread.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight),
    )
    .toBeLessThanOrEqual(24)
  const probe = await page.evaluate(
    () =>
      (
        window as typeof window & {
          __taskyonChatScrollProbe?: { maxDistance: number; samples: number }
        }
      ).__taskyonChatScrollProbe,
  )
  expect(probe?.samples).toBeGreaterThan(5)
  expect(probe?.maxDistance).toBeLessThanOrEqual(24)
})
test('finishing an earlier send does not reopen its conversation', async ({ page }) => {
  await page.goto('/task-chat-responsiveness-test')
  const input = page.getByRole('textbox')
  await input.fill('Keep this in the original conversation')
  await input.press('Enter')
  await expect(page.getByText('Creation is waiting')).toBeVisible()
  await page.getByRole('button', { name: 'Open tool example' }).click()
  await expect(page.getByText('A visible assistant summary')).toBeVisible()
  await page.getByRole('button', { name: 'Confirm creation' }).click()
  await expect(page.locator('[data-cy="pending-chat-message"]')).toHaveCount(0)
  await expect(page.getByText('A visible assistant summary')).toBeVisible()
  await expect(page.locator('[data-cy="taskyon-chat-thread"]')).not.toContainText(
    'Keep this in the original conversation',
  )
})
