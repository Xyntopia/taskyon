import { expect, type FrameLocator, type Locator, type Page, test } from '@playwright/test'
import { join } from 'node:path'

import { dataCy } from '../support/taskyon'

const mapWidgetScreenshotPath = join(
  process.cwd(),
  'test-results/playwright/map-widget-overpass-use-case.png',
)
const entryNodeMapWidgetScreenshotPath = join(
  process.cwd(),
  'test-results/playwright/map-widget-entry-node-overpass-use-case.png',
)
const cafeOverpassQuery =
  '[out:json][timeout:25];node["amenity"="cafe"](around:300,52.5208,13.4095);out tags center geom;'

const overpassElements = [
  {
    type: 'node',
    id: 1,
    lat: 52.521,
    lon: 13.4094,
    tags: { name: 'Cafe Alexanderplatz', amenity: 'cafe' },
  },
  {
    type: 'node',
    id: 2,
    lat: 52.5263,
    lon: 13.4112,
    tags: { name: 'Cafe Rosa Luxemburg', amenity: 'cafe' },
  },
]

const isToggleOn = async (toggle: Locator): Promise<boolean> => {
  const [className, ariaChecked] = await Promise.all([
    toggle.getAttribute('class'),
    toggle.getAttribute('aria-checked'),
  ])
  return className?.includes('q-toggle--truthy') === true || ariaChecked === 'true'
}

const mockOverpassApi = async (page: Page) => {
  await page.route('https://overpass-api.de/api/interpreter', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        version: 0.6,
        generator: 'taskyon-playwright',
        elements: overpassElements,
      }),
    })
  })
}

const mockChatCompletionApi = async (page: Page) => {
  await page.route(
    /\/(?:chatCompletion\/api\/v1\/.*|chat\/completions)(?:\?.*)?$/,
    async (route) => {
      const chunk = {
        id: 'chatcmpl-map-widget-test',
        object: 'chat.completion.chunk',
        created: 0,
        model: 'map-widget-test',
        choices: [
          {
            index: 0,
            delta: { content: JSON.stringify({ overpassQuery: cafeOverpassQuery }) },
            finish_reason: null,
          },
        ],
      }
      const done = {
        ...chunk,
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      }

      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: `data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify(done)}\n\ndata: [DONE]\n\n`,
      })
    },
  )
}

const latestMapWidgetFrame = (page: Page): FrameLocator =>
  page.frameLocator('iframe.markdown-iframe').last()

const enableExpertMode = async (page: Page) => {
  await page.goto('/settings')
  const expertToggle = page.locator('.q-toggle').filter({ hasText: 'Expert Settings' }).first()
  await expect(expertToggle).toBeVisible()

  if (!(await isToggleOn(expertToggle))) {
    await expertToggle.click()
  }

  await expect
    .poll(() => isToggleOn(expertToggle), { message: 'expert mode toggle state' })
    .toBe(true)
}

const waitForOverpassTool = async (page: Page) => {
  await page.goto('/tool/missing-map-widget-test-tool')
  await expect(page.getByRole('link', { name: 'overpassMapTool' })).toBeVisible()
}

const openToolSelector = async (page: Page) => {
  await dataCy(page, 'tool-btn').click()
  const menu = page.locator('.q-menu:visible, .q-dialog:visible').filter({
    hasText: 'Search for a tool you want to use',
  })
  await expect(menu).toBeVisible()
  return menu
}

const selectOverpassMapTool = async (page: Page) => {
  const menu = await openToolSelector(page)
  const option = menu.locator('.q-item').filter({
    hasText: 'overpassMapTool',
  })
  await expect(option).toBeVisible()
  await option.first().click()
  await expect(page.locator('.create-tasks__mode')).toContainText('overpassMapTool')
}

const fillToolParameter = async (page: Page, name: 'overpassQuery' | 'query', value: string) => {
  const field = dataCy(page, name).last()
  await expect(field).toBeVisible()
  const addPlaceholder = page.getByRole('button', { name: `+ ${name}` })
  if (await addPlaceholder.isVisible()) {
    await addPlaceholder.click()
  }
  const input = field.locator('textarea, input').first()
  await input.fill(value)
  await expect(input).toHaveValue(value)
}

const executeSelectedTool = async (page: Page) => {
  const executeButton = page.locator('.create-tasks__execute-button').first()
  await expect(executeButton).toBeVisible()
  await executeButton.click()
}

const runOverpassToolFromVisibleForm = async (
  page: Page,
  args: { overpassQuery: string } | { query: string },
) => {
  await waitForOverpassTool(page)
  await enableExpertMode(page)
  await page.goto('/')
  await expect(dataCy(page, 'tool-btn')).toBeVisible()
  await selectOverpassMapTool(page)

  if ('overpassQuery' in args) {
    await fillToolParameter(page, 'overpassQuery', args.overpassQuery)
  } else {
    await fillToolParameter(page, 'query', args.query)
  }

  await executeSelectedTool(page)
}

const expectMapWidgetInChat = async (page: Page, frame: FrameLocator) => {
  const summaryMessage = page
    .locator('.assistant.message')
    .filter({ hasText: 'Found 2 overpass results' })
    .last()
  await expect(summaryMessage).toBeVisible({ timeout: 100_000 })
  await expect(summaryMessage).toContainText('Cafe Alexanderplatz')
  await expect(summaryMessage).toContainText('Cafe Rosa Luxemburg')
  await expect(page.locator('.assistant.message iframe.markdown-iframe').last()).toBeVisible()
  await expect(frame.getByText('Invalid map widget payload.')).toBeHidden()

  const canvas = frame.locator('.maplibregl-canvas').first()
  await expect(canvas).toBeVisible()
  await expect
    .poll(async () => {
      const canvasBox = await canvas.boundingBox()
      return !!canvasBox && canvasBox.width > 100 && canvasBox.height > 100
    })
    .toBe(true)

  const markers = frame.locator('.taskyon-geo-map-widget__marker')
  await expect(markers).toHaveCount(2)
  await expect
    .poll(async () => {
      return await markers.first().evaluate((marker) => {
        const markerBox = marker.getBoundingClientRect()
        const hit = document.elementFromPoint(
          markerBox.x + markerBox.width / 2,
          markerBox.y + markerBox.height / 2,
        )
        return hit?.classList.contains('taskyon-geo-map-widget__marker') === true
      })
    })
    .toBe(true)
}

test.describe('map widget in chat', () => {
  test.beforeEach(async ({ page }) => {
    await mockOverpassApi(page)
    await enableExpertMode(page)
  })

  test('renders a directly called Overpass map tool result inside the chat', async ({ page }) => {
    await runOverpassToolFromVisibleForm(page, { overpassQuery: cafeOverpassQuery })

    const frame = latestMapWidgetFrame(page)
    await expectMapWidgetInChat(page, frame)

    await page.screenshot({
      path: mapWidgetScreenshotPath,
      fullPage: true,
    })
  })

  test('renders a natural-language Overpass flow as a map result in chat', async ({ page }) => {
    await mockChatCompletionApi(page)

    await runOverpassToolFromVisibleForm(page, {
      query: 'Use Overpass to show cafes near Alexanderplatz in Berlin on a map.',
    })

    const frame = latestMapWidgetFrame(page)
    await expectMapWidgetInChat(page, frame)

    await page.screenshot({
      path: entryNodeMapWidgetScreenshotPath,
      fullPage: true,
    })
  })
})
