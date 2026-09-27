import { expect, test, type Page } from '@playwright/test'
import type { FunctionArguments } from '@taskyon/tyclient'

type PageIOTestBridge = {
  call: (args: FunctionArguments) => Promise<unknown>
  callWithoutScreenshot: (args: FunctionArguments) => Promise<unknown>
  callReadOnly: (args: FunctionArguments) => Promise<unknown>
  callGuide: (args: FunctionArguments) => Promise<unknown>
  consentCalls: () => number
  screenshotCalls: () => number
  setConsent: (next: boolean) => void
  storedScreenshots: () => unknown[]
  screenshotActions: () => unknown
  actionsWithoutScreenshot: () => unknown
  readOnlyActions: () => unknown
  guideActions: () => unknown
}
type PageIOBridgeReadMethod =
  | 'consentCalls'
  | 'screenshotCalls'
  | 'storedScreenshots'
  | 'screenshotActions'
  | 'actionsWithoutScreenshot'
  | 'readOnlyActions'
  | 'guideActions'

declare global {
  interface Window {
    __pageIOTest?: PageIOTestBridge
  }
}

const dataTestIdSelector = (testId: string) => `[data-testid="${testId}"]`

const callPageIO = async (page: Page, args: FunctionArguments) =>
  await page.evaluate(async (nextArgs) => {
    if (!window.__pageIOTest) throw new Error('pageIO test bridge is unavailable')
    return await window.__pageIOTest.call(nextArgs)
  }, args)

const bridgeValue = async (page: Page, key: PageIOBridgeReadMethod) =>
  await page.evaluate((methodName) => {
    if (!window.__pageIOTest) throw new Error('pageIO test bridge is unavailable')
    const method = window.__pageIOTest[methodName]
    return method()
  }, key)

const setConsent = async (page: Page, next: boolean) =>
  await page.evaluate((nextValue) => {
    if (!window.__pageIOTest) throw new Error('pageIO test bridge is unavailable')
    window.__pageIOTest.setConsent(nextValue)
  }, next)

const readEnum = (value: unknown): string[] => {
  if (!value || typeof value !== 'object' || !('enum' in value)) return []
  const enumValue = value.enum
  return Array.isArray(enumValue) ? enumValue.filter((item) => typeof item === 'string') : []
}

test.describe('pageIO browser tool', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/pageio-test')
    await expect(page.locator(dataTestIdSelector('pageio-result'))).toBeVisible()
  })

  test('lists, fills, and clicks generic page controls', async ({ page }) => {
    const listed = await callPageIO(page, { action: 'list', limit: 20 })
    expect(listed).toMatchObject({
      elements: expect.arrayContaining([
        expect.objectContaining({ selector: dataTestIdSelector('pageio-name') }),
        expect.objectContaining({ selector: dataTestIdSelector('pageio-notes') }),
        expect.objectContaining({ selector: dataTestIdSelector('pageio-priority') }),
        expect.objectContaining({ selector: dataTestIdSelector('pageio-button') }),
      ]),
    })

    await callPageIO(page, {
      action: 'fill',
      selector: dataTestIdSelector('pageio-name'),
      value: 'Ada',
    })
    await callPageIO(page, {
      action: 'fill',
      selector: dataTestIdSelector('pageio-notes'),
      value: 'browser form',
    })
    await callPageIO(page, {
      action: 'fill',
      selector: dataTestIdSelector('pageio-priority'),
      value: 'high',
    })
    await callPageIO(page, {
      action: 'click',
      selector: dataTestIdSelector('pageio-button'),
    })

    await expect(page.locator(dataTestIdSelector('pageio-result'))).toContainText(
      'Ada|browser form|high|1',
    )
  })

  test('reports location and navigates through browser APIs', async ({ page }) => {
    const where = await callPageIO(page, { action: 'where' })
    expect(where).toMatchObject({
      pathname: '/pageio-test',
      hash: '',
    })

    await callPageIO(page, {
      action: 'navigate',
      url: '/pageio-test#target',
    })
    await page.waitForURL('**/pageio-test#target')
    await expect(page.locator(dataTestIdSelector('pageio-target'))).toBeVisible()
  })

  test('only advertises screenshot when the optional adapter is installed', async ({ page }) => {
    const screenshotActions = readEnum(await bridgeValue(page, 'screenshotActions'))
    const plainActions = readEnum(await bridgeValue(page, 'actionsWithoutScreenshot'))

    expect(screenshotActions).toContain('screenshot')
    expect(plainActions).not.toContain('screenshot')
  })

  test('requires consent before storing a session screenshot', async ({ page }) => {
    await setConsent(page, false)
    await expect(callPageIO(page, { action: 'screenshot' })).resolves.toMatchObject({
      cancelled: true,
    })
    expect(await bridgeValue(page, 'consentCalls')).toBe(1)
    expect(await bridgeValue(page, 'screenshotCalls')).toBe(0)
    expect(await bridgeValue(page, 'storedScreenshots')).toEqual([])

    await setConsent(page, true)
    await expect(callPageIO(page, { action: 'screenshot' })).resolves.toMatchObject({
      mediaType: 'image/png',
      width: 1,
      height: 1,
    })
    expect(await bridgeValue(page, 'consentCalls')).toBe(2)
    expect(await bridgeValue(page, 'screenshotCalls')).toBe(1)
    expect(await bridgeValue(page, 'storedScreenshots')).toHaveLength(1)
  })

  test('inspection mode exposes only bounded, read-only page guidance', async ({ page }) => {
    const actions = readEnum(await bridgeValue(page, 'readOnlyActions'))
    expect(actions).toEqual(['where', 'list'])
    const where = await page.evaluate(
      async () => await window.__pageIOTest?.callReadOnly({ action: 'where' }),
    )
    expect(where).toMatchObject({ pathname: '/pageio-test', title: expect.any(String) })
    expect(where).not.toHaveProperty('search')
    expect(where).not.toHaveProperty('hash')
    await page.locator(dataTestIdSelector('pageio-button')).evaluate((button) => {
      button.setAttribute('aria-label', 'A'.repeat(300))
    })
    const listed = await page.evaluate(
      async () => await window.__pageIOTest?.callReadOnly({ action: 'list', limit: 1000 }),
    )
    expect(listed).toMatchObject({ elements: expect.any(Array) })
    expect((listed as { elements: unknown[] }).elements.length).toBeLessThanOrEqual(32)
    expect(
      (listed as { elements: { selector: string; label?: string }[] }).elements.find(
        (element) => element.selector === '[data-testid="pageio-button"]',
      )?.label?.length,
    ).toBe(160)
    await expect(
      page.evaluate(
        async () =>
          await window.__pageIOTest?.callReadOnly({
            action: 'click',
            selector: '[data-testid="pageio-button"]',
          }),
      ),
    ).rejects.toThrow('not available')
    await expect(page.locator(dataTestIdSelector('pageio-result'))).toContainText('|0')
  })

  test('guide mode marks one visible control and restores its original outline', async ({
    page,
  }) => {
    expect(readEnum(await bridgeValue(page, 'guideActions'))).toEqual([
      'where',
      'list',
      'mark',
      'clearMark',
    ])
    const button = page.locator(dataTestIdSelector('pageio-button'))
    await button.evaluate((element) => {
      element.style.setProperty('outline', '1px dotted red')
    })
    const originalOutline = await button.evaluate((element) =>
      element.style.getPropertyValue('outline'),
    )

    await expect(
      page.evaluate(
        async () =>
          await window.__pageIOTest?.callGuide({
            action: 'mark',
            selector: '[data-testid="pageio-button"]',
          }),
      ),
    ).resolves.toMatchObject({ marked: '[data-testid="pageio-button"]' })
    await expect(button).toHaveCSS('outline-style', 'solid')
    await expect(page.locator(dataTestIdSelector('pageio-result'))).toContainText('|0')

    await expect(
      page.evaluate(async () => await window.__pageIOTest?.callGuide({ action: 'clearMark' })),
    ).resolves.toMatchObject({ cleared: true })
    expect(await button.evaluate((element) => element.style.getPropertyValue('outline'))).toBe(
      originalOutline,
    )
  })

  test('guide mode cannot mark hidden elements or click controls', async ({ page }) => {
    const buttonSelector = dataTestIdSelector('pageio-button')
    await expect(
      page.evaluate(
        async (selector) => await window.__pageIOTest?.callGuide({ action: 'click', selector }),
        buttonSelector,
      ),
    ).rejects.toThrow('not available')
    await page.locator(buttonSelector).evaluate((element) => {
      element.style.display = 'none'
    })
    await expect(
      page.evaluate(
        async (selector) => await window.__pageIOTest?.callGuide({ action: 'mark', selector }),
        buttonSelector,
      ),
    ).rejects.toThrow('not visible')
    await expect(page.locator(dataTestIdSelector('pageio-result'))).toContainText('|0')
  })
})
