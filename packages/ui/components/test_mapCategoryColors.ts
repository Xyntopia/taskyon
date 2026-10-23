import { createApp, h, nextTick, ref } from 'vue'
import type { Component } from 'vue'
import type { ObjectPathChartDefinition } from './objectPathChartTypes'
import type {
  ObjectPathChartsMapRendererSlotProps,
  ObjectPathChartsViewOptions,
} from './ObjectPathCharts.vue'

const waitFor = async (condition: () => boolean) => {
  const deadline = Date.now() + 5000
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Expected category-color editor UI did not appear.')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

const clickButton = (container: ParentNode, label: string) => {
  const button = [...container.querySelectorAll('button')].find(
    (element) => element.textContent?.trim() === label && element.getClientRects().length,
  )
  if (!button) throw new Error(`Missing visible button: ${label}`)
  button.click()
}

export const testMapCategoryColorEditor = async () => {
  if (typeof document === 'undefined')
    return { skipped: true, reason: 'Requires a browser DOM and Vue component rendering.' }
  const componentUrl = new URL('./ObjectPathCharts.vue', import.meta.url).href
  const { default: ObjectPathCharts }: { default: Component } = await import(
    /* @vite-ignore */ componentUrl
  )
  const q = await import('quasar')
  const charts = ref<ObjectPathChartDefinition[]>([
    {
      kind: 'map',
      featurePath: 'feature',
      valuePath: 'category',
      showContour: false,
      categoryStyles: {
        P: { label: 'Prime farmland', color: '#f4a582' },
        L: { label: 'Local importance' },
        unseen: { label: 'Not in this result', color: '#abcdef' },
      },
    },
  ])
  const options = ref<ObjectPathChartsViewOptions>({ viewMode: 'full' })
  const showControls = ref(true)
  const rows = ['P', 'L'].map((category) => ({
    'feature.type': 'Feature',
    'feature.geometry.type': 'Polygon',
    'feature.geometry.coordinates': [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 0],
      ],
    ],
    category,
  }))
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({
    setup: () => () =>
      h(
        ObjectPathCharts,
        {
          modelValue: charts.value,
          'onUpdate:modelValue': (value: ObjectPathChartDefinition[]) => {
            charts.value = value
          },
          options: options.value,
          'onUpdate:options': (value: ObjectPathChartsViewOptions) => {
            options.value = value
          },
          showControls: showControls.value,
          mapRows: rows,
          pathOptions: [
            { label: 'Category', value: 'category' },
            { label: 'Feature', value: 'feature' },
          ],
          pathKindByPath: { category: 'other', feature: 'feature' },
        },
        {
          'map-renderer': ({ mapValue }: ObjectPathChartsMapRendererSlotProps) =>
            h(
              'div',
              mapValue.layers.flatMap((layer) =>
                layer.features.map((feature) =>
                  h('span', {
                    'data-map-category': feature.properties?.__plotCategory,
                    'data-map-color': feature.properties?.__plotColor,
                  }),
                ),
              ),
            ),
        },
      ),
  })
  app.use(q.Quasar, {
    components: {
      QBadge: q.QBadge,
      QBtn: q.QBtn,
      QBtnToggle: q.QBtnToggle,
      QCard: q.QCard,
      QCardSection: q.QCardSection,
      QCardActions: q.QCardActions,
      QDialog: q.QDialog,
      QInput: q.QInput,
      QList: q.QList,
      QItem: q.QItem,
      QItemSection: q.QItemSection,
      QItemLabel: q.QItemLabel,
      QSelect: q.QSelect,
      QSpace: q.QSpace,
      QSeparator: q.QSeparator,
      QToggle: q.QToggle,
    },
    directives: { ClosePopup: q.ClosePopup },
  })
  const button = () =>
    [...host.querySelectorAll('[data-cy="map-category-colors"]')].find(
      (element) => element.getClientRects().length,
    )
  const dialog = () => document.querySelector('[data-cy="map-category-colors-dialog"]')
  const open = async () => {
    clickButton(host, 'Category colors')
    await waitFor(() => !!dialog())
  }
  const choose = (category: string, color: string) => {
    const input = dialog()?.querySelector(`[data-category="${category}"] input[type="color"]`)
    if (!(input instanceof HTMLInputElement)) throw new Error('Missing category color picker.')
    input.value = color
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }
  try {
    app.mount(host)
    await nextTick()
    clickButton(host, 'Update All Charts')
    await waitFor(() => !!button())
    await open()
    if (dialog()?.querySelectorAll('[data-category]').length !== 2)
      throw new Error('List the evaluated categories without duplicating or inventing rows.')
    choose('L', '#123456')
    clickButton(dialog()!, 'Cancel')
    await waitFor(() => !dialog())
    if (charts.value[0]?.categoryStyles?.L?.color !== undefined)
      throw new Error('Cancel must leave the saved plot configuration unchanged.')
    await open()
    choose('L', '#123456')
    clickButton(dialog()!, 'Apply')
    await waitFor(() => !!host.querySelector('[data-map-category="L"][data-map-color="#123456"]'))
    if (
      charts.value[0]?.categoryStyles?.L?.color !== '#123456' ||
      charts.value[0]?.categoryStyles?.unseen?.color !== '#abcdef'
    )
      throw new Error('Apply must persist the color and retain styles absent from current results.')
    await waitFor(() => !dialog())
    await open()
    clickButton(dialog()!.querySelector('[data-category="L"]')!, 'Automatic')
    clickButton(dialog()!, 'Apply')
    await waitFor(() => !!button() && !dialog())
    if (
      charts.value[0]?.categoryStyles?.L?.color !== undefined ||
      host.querySelector('[data-map-category="L"]')?.getAttribute('data-map-color') === '#123456'
    )
      throw new Error('Automatic must remove the override and redraw the generated palette.')
    for (const mode of ['View only', 'Thumbnails']) {
      clickButton(host, mode)
      await nextTick()
      if (button()) throw new Error('Only edit mode may display the category-color button.')
    }
    const thumbnail = host.querySelector('.object-path-charts__thumb-card')
    if (!(thumbnail instanceof HTMLElement)) throw new Error('Expected a map thumbnail.')
    thumbnail.click()
    await waitFor(() => !!document.querySelector('[data-cy="object-path-charts-thumbnail-dialog"]'))
    const thumbnailDialog = document.querySelector(
      '[data-cy="object-path-charts-thumbnail-dialog"]',
    )!
    if (thumbnailDialog.querySelector('[data-cy="map-category-colors"]'))
      throw new Error('Thumbnail popups must not expose category-color editing.')
    clickButton(thumbnailDialog, 'Close')
    await waitFor(() => !document.querySelector('[data-cy="object-path-charts-thumbnail-dialog"]'))
    clickButton(host, 'Full')
    await nextTick()
    showControls.value = false
    await nextTick()
    if (button()) throw new Error('Read-only embedding must hide category-color editing.')
    return { success: true }
  } finally {
    app.unmount()
    host.remove()
  }
}
