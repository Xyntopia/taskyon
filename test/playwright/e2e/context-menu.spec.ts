import { expect, test, type Page } from '@playwright/test'

const taskMenuCopyButton = (page: Page) =>
  page.getByLabel('copy markdown text').filter({ visible: true })

const expectMenuAt = async (page: Page, pointer: { x: number; y: number }) => {
  const menu = taskMenuCopyButton(page)
  await expect(menu).toBeVisible()

  const menuBox = await menu.boundingBox()
  if (!menuBox) throw new Error('context menu has no bounding box')
  expect(Math.abs(menuBox.x - pointer.x)).toBeLessThan(40)
  // The menu may flip above the pointer when there is no room below it.
  const verticalGap = Math.min(
    Math.abs(menuBox.y - pointer.y),
    Math.abs(menuBox.y + menuBox.height - pointer.y),
  )
  expect(verticalGap).toBeLessThan(80)
}

test.describe('task context menu', () => {
  test('opens at the pointer on right-click', async ({ page }) => {
    await page.goto('/task-chat-presentation-test')
    const widget = page.locator('.task-display').first()
    await expect(widget).toBeVisible()
    await widget.scrollIntoViewIfNeeded()

    const box = await widget.boundingBox()
    if (!box) throw new Error('task widget has no bounding box')
    const pointer = { x: box.x + box.width / 2, y: box.y + Math.min(box.height / 2, 20) }

    await page.mouse.click(pointer.x, pointer.y, { button: 'right' })
    await expectMenuAt(page, pointer)
  })

  test('opens on another message while text elsewhere is selected', async ({ page }) => {
    await page.goto('/task-chat-presentation-test')
    const widgets = page.locator('.task-display')
    await expect(widgets.first()).toBeVisible()
    await widgets.first().locator('code.storage-operation__location').dblclick()
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).not.toBe('')

    await widgets.nth(1).click({ button: 'right' })
    await expect(taskMenuCopyButton(page)).toBeVisible()
  })

  test('keeps the native menu for a selection inside the message', async ({ page }) => {
    await page.goto('/task-chat-presentation-test')
    const widget = page.locator('.task-display').first()
    const text = widget.locator('code.storage-operation__location')
    await expect(text).toBeVisible()
    await text.dblclick()

    await page.evaluate(() => {
      const events: Array<{ prevented: boolean }> = []
      ;(
        window as unknown as { contextMenuEvents: Array<{ prevented: boolean }> }
      ).contextMenuEvents = events
      document.addEventListener('contextmenu', (event) => {
        events.push({ prevented: event.defaultPrevented })
      })
    })
    await text.click({ button: 'right' })
    const events = await page.evaluate(
      () =>
        (window as unknown as { contextMenuEvents: Array<{ prevented: boolean }> })
          .contextMenuEvents,
    )

    expect(events[0]?.prevented).toBe(false)
    await expect(taskMenuCopyButton(page)).toBeHidden()
  })

  test('opens inside an HTML message rendered in the sandboxed iframe', async ({ page }) => {
    await page.goto('/task-chat-presentation-test')
    const widget = page.locator('[data-task-id="rich-html-message"]')
    await expect(widget).toBeVisible()

    const iframe = widget.locator('iframe.markdown-iframe')
    await expect(iframe).toBeVisible()
    const frame = widget.frameLocator('iframe.markdown-iframe')
    const bold = frame.locator('b')
    await expect(bold).toBeVisible()

    await bold.click({ button: 'right' })
    const boldBox = await bold.boundingBox()
    if (!boldBox) throw new Error('iframe message has no bounding box')
    await expectMenuAt(page, {
      x: boldBox.x + boldBox.width / 2,
      y: boldBox.y + boldBox.height / 2,
    })
  })
})
