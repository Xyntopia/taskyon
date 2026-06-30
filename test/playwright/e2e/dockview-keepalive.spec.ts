import { expect, test } from '@playwright/test'

import { dataCy } from '../support/taskyon'

test.describe('dockview keepAliveViews', () => {
  test('keeps a configured view mounted while minimized', async ({ page }) => {
    await page.goto('/dockview')

    await dataCy(page, 'dock-tab-panel-KeepAliveTicker').click()

    const mountId = (await dataCy(page, 'keepalive-mount-id').textContent())?.trim()
    expect(mountId).toBeTruthy()
    if (!mountId) throw new Error('KeepAliveTicker mount id was not rendered.')

    const tickBeforeMinimize = Number.parseInt(
      ((await dataCy(page, 'keepalive-ticks').textContent()) ?? '').trim(),
      10,
    )
    expect(tickBeforeMinimize).toBeGreaterThanOrEqual(0)

    await dataCy(page, 'dock-splitter-toggle-left-main-0').click()
    await page.waitForTimeout(900)
    await dataCy(page, 'dock-splitter-toggle-left-main-0').click()
    await expect(dataCy(page, 'dock-view-panel-KeepAliveTicker')).toBeVisible()
    const restoredBox = await dataCy(page, 'dock-view-panel-KeepAliveTicker').boundingBox()
    expect(restoredBox?.height).toBeGreaterThan(80)

    await dataCy(page, 'dock-splitter-toggle-left-main-0').locator('..').dblclick()
    await page.waitForTimeout(700)
    await dataCy(page, 'dock-splitter-toggle-left-main-0').locator('..').dblclick()

    await dataCy(page, 'dock-minimize-panel').click()
    await page.waitForTimeout(1_200)

    await dataCy(page, 'dock-tab-panel-KeepAliveTicker').click()
    await expect(dataCy(page, 'keepalive-mount-id')).toHaveText(mountId)

    await expect
      .poll(async () =>
        Number.parseInt(((await dataCy(page, 'keepalive-ticks').textContent()) ?? '').trim(), 10),
      )
      .toBeGreaterThan(tickBeforeMinimize)
  })
})
