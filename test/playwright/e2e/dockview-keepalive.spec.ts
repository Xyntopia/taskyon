import { expect, test } from '@playwright/test'

import { dataCy } from '../support/taskyon'

const dragTab = async (
  page: Parameters<typeof dataCy>[0],
  source: ReturnType<typeof dataCy>,
  target: ReturnType<typeof dataCy>,
  targetPosition: { x: number; y: number },
) => {
  await source.dragTo(target, { targetPosition })
}

test.describe('dockview keepAliveViews', () => {
  test('moves a tab when it is dropped on unused tab rail space', async ({ page }) => {
    await page.goto('/dockview')
    await expect(dataCy(page, 'dock-tab-sidebar-Search')).toBeVisible()
    await expect(dataCy(page, 'dock-tabs-header-editors')).toBeVisible()

    await page.evaluate(() => {
      const source = document.querySelector<HTMLElement>('[data-cy="dock-tab-sidebar-Search"]')
      const target = document.querySelector<HTMLElement>('[data-cy="dock-tabs-header-editors"]')
      if (!source || !target) throw new Error('Expected DockView drag source and tab rail.')
      const dataTransfer = new DataTransfer()
      source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }))
      target.dispatchEvent(
        new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }),
      )
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }))
    })

    await expect(page.locator('.dock-tab[data-view-id="Search"]')).toHaveAttribute(
      'data-leaf-id',
      'editors',
    )
  })

  test('reorders tabs and creates an edge split with an occupancy preview', async ({ page }) => {
    await page.goto('/dockview')

    const editorContent = dataCy(page, 'dock-content-editors')
    const editorBox = await editorContent.boundingBox()
    expect(editorBox).not.toBeNull()
    if (!editorBox) throw new Error('Expected the editor drop target to have bounds.')

    const stylesTab = dataCy(page, 'dock-tab-editors-styles.css')
    const appTab = dataCy(page, 'dock-tab-editors-App.vue')
    await dragTab(page, stylesTab, appTab, { x: 2, y: 12 })
    await expect(dataCy(page, 'dock-tab-editors-styles.css')).toHaveAttribute('data-tab-index', '0')

    await page.evaluate(() => {
      const source = document.querySelector<HTMLElement>('[data-cy="dock-tab-sidebar-Search"]')
      const target = document.querySelector<HTMLElement>('[data-cy="dock-content-editors"]')
      if (!source || !target) throw new Error('Expected DockView drag source and target.')
      const dataTransfer = new DataTransfer()
      ;(
        window as typeof window & { dockViewTestDataTransfer?: DataTransfer }
      ).dockViewTestDataTransfer = dataTransfer
      source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }))
      const rect = target.getBoundingClientRect()
      target.dispatchEvent(
        new DragEvent('dragover', {
          bubbles: true,
          cancelable: true,
          clientX: rect.right - 8,
          clientY: rect.top + rect.height / 2,
          dataTransfer,
        }),
      )
    })

    const preview = page.locator('[data-cy^="dock-drop-preview-"]')
    await expect(preview).toHaveAttribute('data-dock-position', 'right')
    const previewBox = await preview.boundingBox()
    expect(previewBox).not.toBeNull()
    expect(previewBox!.width).toBeGreaterThan(editorBox.width * 0.4)
    expect(previewBox!.width).toBeLessThan(editorBox.width * 0.6)

    await page.evaluate(() => {
      const target = document.querySelector<HTMLElement>('[data-cy="dock-content-editors"]')
      const dataTransfer = (window as typeof window & { dockViewTestDataTransfer?: DataTransfer })
        .dockViewTestDataTransfer
      if (!target || !dataTransfer) throw new Error('Expected the active DockView test drag.')
      const rect = target.getBoundingClientRect()
      target.dispatchEvent(
        new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          clientX: rect.right - 8,
          clientY: rect.top + rect.height / 2,
          dataTransfer,
        }),
      )
    })
    const movedSearch = page.locator('.dock-tab[data-view-id="Search"]')
    await expect(movedSearch).toHaveCount(1)
    await expect(movedSearch).not.toHaveAttribute('data-leaf-id', 'sidebar')

    const resizedEditorBox = await editorContent.boundingBox()
    expect(resizedEditorBox).not.toBeNull()
    if (!resizedEditorBox) throw new Error('Expected resized editor bounds.')
    await dragTab(page, dataCy(page, 'dock-tab-sidebar-ExplorerWithAVeryLongName'), editorContent, {
      x: resizedEditorBox.width / 2,
      y: resizedEditorBox.height / 2,
    })
    await expect(page.locator('[data-dock-node-id="sidebar"]')).toHaveCount(0)
  })

  test('preserves a mounted view instance while moving it between panes', async ({ page }) => {
    await page.goto('/dockview')
    await dataCy(page, 'dock-tab-panel-KeepAliveTicker').click()

    const mountId = (await dataCy(page, 'keepalive-mount-id').textContent())?.trim()
    expect(mountId).toBeTruthy()

    const editorContent = dataCy(page, 'dock-content-editors')
    const editorBox = await editorContent.boundingBox()
    expect(editorBox).not.toBeNull()
    if (!editorBox) throw new Error('Expected the editor drop target to have bounds.')

    await dragTab(page, dataCy(page, 'dock-tab-panel-KeepAliveTicker'), editorContent, {
      x: editorBox.width / 2,
      y: editorBox.height / 2,
    })

    await expect(dataCy(page, 'keepalive-mount-id')).toHaveText(mountId!)
    await expect(page.locator('.dock-tab[data-view-id="KeepAliveTicker"]')).toHaveAttribute(
      'data-leaf-id',
      'editors',
    )
  })

  test('keeps the active view attached when a sibling is split into a new pane', async ({
    page,
  }) => {
    await page.goto('/dockview')
    await dataCy(page, 'dock-tab-panel-KeepAliveTicker').click()

    const mountId = (await dataCy(page, 'keepalive-mount-id').textContent())?.trim()
    expect(mountId).toBeTruthy()

    const panelContent = dataCy(page, 'dock-content-panel')
    const panelBox = await panelContent.boundingBox()
    expect(panelBox).not.toBeNull()
    if (!panelBox) throw new Error('Expected the panel drop target to have bounds.')

    await dragTab(page, dataCy(page, 'dock-tab-panel-Terminal'), panelContent, {
      x: panelBox.width - 2,
      y: panelBox.height / 2,
    })

    await expect(dataCy(page, 'keepalive-mount-id')).toHaveText(mountId!)
    await expect(dataCy(page, 'keepalive-mount-id')).toBeVisible()
  })

  test('honors the host docking policy', async ({ page }) => {
    await page.goto('/dockview')

    const panelContent = dataCy(page, 'dock-content-panel')
    const panelBox = await panelContent.boundingBox()
    expect(panelBox).not.toBeNull()
    if (!panelBox) throw new Error('Expected the panel drop target to have bounds.')

    await dragTab(page, dataCy(page, 'dock-tab-editors-Nested'), panelContent, {
      x: panelBox.width / 2,
      y: panelBox.height / 2,
    })

    await expect(dataCy(page, 'dock-tab-editors-Nested')).toBeVisible()
    await expect(page.locator('.dock-tab[data-view-id="Nested"]')).toHaveAttribute(
      'data-leaf-id',
      'editors',
    )
  })

  test('retains a pane configured to remain when its last tab moves', async ({ page }) => {
    await page.goto('/dockview')

    const editorContent = dataCy(page, 'dock-content-editors')
    const editorBox = await editorContent.boundingBox()
    expect(editorBox).not.toBeNull()
    if (!editorBox) throw new Error('Expected the editor drop target to have bounds.')

    for (const viewId of ['Terminal', 'Output', 'KeepAliveTicker']) {
      await dragTab(page, dataCy(page, `dock-tab-panel-${viewId}`), editorContent, {
        x: editorBox.width / 2,
        y: editorBox.height / 2,
      })
    }

    await expect(page.locator('[data-dock-node-id="panel"]')).toBeVisible()
    await expect(dataCy(page, 'dock-content-panel').getByText('No Views')).toBeVisible()
  })

  test('offers static and factory entries from the add-view menu', async ({ page }) => {
    await page.goto('/dockview')

    await dataCy(page, 'dock-close-editors-App.vue').click()
    await dataCy(page, 'dock-add-editors').click()
    await expect(dataCy(page, 'dock-add-option-editors-App.vue')).toBeVisible()
    await dataCy(page, 'dock-add-option-editors-App.vue').click()
    await expect(dataCy(page, 'dock-tab-editors-App.vue')).toBeVisible()

    await dataCy(page, 'dock-add-editors').click()
    await dataCy(page, 'dock-add-option-editors-new-file').click()
    await expect(dataCy(page, 'dock-tab-editors-New_File_1')).toBeVisible()
  })

  test('supports compact vertical navigation in a nested leaf', async ({ page }) => {
    await page.goto('/dockview')

    const sidebarHeader = dataCy(page, 'dock-tabs-header-sidebar')
    const searchTab = dataCy(page, 'dock-tab-sidebar-Search')

    await expect(sidebarHeader).toHaveClass(/dock-tabs-header--left/)
    await expect(sidebarHeader).not.toHaveClass(/dock-tabs-header--compact/)

    const sidebarPane = sidebarHeader.locator('..')
    const paneToggle = dataCy(page, 'dock-minimize-sidebar')
    await paneToggle.click()
    await expect(sidebarPane).not.toHaveClass(/dock-node--tabs-left/)
    await expect(sidebarHeader).toHaveClass(/dock-tabs-header--vertical/)
    const restoreButtonBox = await paneToggle.boundingBox()
    const collapsedTabBox = await searchTab.boundingBox()
    expect(restoreButtonBox).not.toBeNull()
    expect(collapsedTabBox).not.toBeNull()
    expect(collapsedTabBox!.width).toBeGreaterThan(24)
    expect(collapsedTabBox!.height).toBeLessThan(120)
    expect(collapsedTabBox!.y).toBeGreaterThanOrEqual(
      restoreButtonBox!.y + restoreButtonBox!.height,
    )
    await paneToggle.click()

    await searchTab.click()
    await expect(dataCy(page, 'dockview-last-activated')).toHaveText('sidebar:Search')
    await expect(dataCy(page, 'dock-view-sidebar-Search')).toBeVisible()
    await expect(sidebarHeader).toHaveClass(/dock-tabs-header--compact/)

    await dataCy(page, 'dock-tab-rail-toggle-sidebar').click()
    await expect(sidebarHeader).not.toHaveClass(/dock-tabs-header--compact/)
    await expect(dataCy(page, 'dock-view-sidebar-Search')).toBeVisible()

    const explorerTab = dataCy(page, 'dock-tab-sidebar-ExplorerWithAVeryLongName')
    await explorerTab.focus()
    await explorerTab.press('Enter')
    await expect(sidebarHeader).toHaveClass(/dock-tabs-header--compact/)
    await expect(dataCy(page, 'dockview-last-activated')).toHaveText(
      'sidebar:ExplorerWithAVeryLongName',
    )
    await expect(dataCy(page, 'dock-view-sidebar-ExplorerWithAVeryLongName')).toBeVisible()
  })

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
