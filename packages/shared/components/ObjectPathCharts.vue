<template>
  <div class="object-path-charts column q-gutter-md">
    <div class="row items-center q-gutter-sm">
      <q-btn dense flat color="primary" label="Add Chart" @click="addChartAndOpen" />
      <q-btn-toggle
        v-model="mode"
        dense
        unelevated
        toggle-color="primary"
        color="grey-8"
        text-color="grey-4"
        :options="[
          { label: 'Full', value: 'full' },
          { label: 'View only', value: 'viewOnly' },
          { label: 'Thumbnails', value: 'thumbnail' },
        ]"
      />
    </div>

    <q-card v-if="!sourceObject || pathOptions.length === 0" flat bordered class="object-path-charts__card">
      <q-card-section class="text-caption text-grey-7">
        No plottable numeric series found yet.
      </q-card-section>
    </q-card>

    <q-card
      v-for="(chart, index) in chartList"
      v-show="mode === 'full' || mode === 'viewOnly'"
      :key="chart.key"
      flat
      bordered
      class="object-path-charts__card"
    >
      <q-card-section class="q-gutter-sm">
        <ObjectPathChartAxesEditor
          v-if="!isViewOnly"
          :config="chart.config"
          :path-options="filteredPathOptions"
          :show-remove="true"
          @filter="filterPathOptions"
          @update:config="(next) => updateChartConfig(index, next)"
          @remove="removeChart(index)"
        />

        <div v-if="chart.value !== undefined" class="object-path-charts__chart">
          <ListChart
            :value="chart.value"
            :title="chart.title"
            :show-controls="!isViewOnly"
            :enable-data-zoom="!isViewOnly"
            :show-axis-ticks="true"
            :show-axis-units="true"
            :x-axis="{ label: toAxisLabel(chart.config.x) }"
            :y-axis="{ label: toAxisLabel(chart.config.z || chart.config.y) }"
          />
        </div>
        <div v-else class="text-caption text-grey-7">
          Pick valid axis paths to render this chart.
        </div>
      </q-card-section>
    </q-card>

    <q-card v-if="mode === 'thumbnail'" flat bordered class="object-path-charts__card">
      <q-card-section>
        <div class="object-path-charts__thumb-grid">
          <q-card
            v-for="(chart, index) in chartList"
            :key="`thumb:${chart.key}`"
            flat
            bordered
            class="object-path-charts__thumb-card cursor-pointer"
            :class="{ 'object-path-charts__thumb-disabled': chart.value === undefined }"
            @click="chart.value !== undefined && openThumbnailPopup(index)"
          >
            <q-card-section class="q-pa-xs">
              <div class="object-path-charts__thumb-chart">
                <ListChart
                  v-if="chart.value !== undefined"
                  :value="chart.value"
                  :show-controls="false"
                  :enable-data-zoom="false"
                  :show-axis-ticks="false"
                  :show-axis-units="false"
                  chart-height="150px"
                  :x-axis="{ label: toAxisLabel(chart.config.x) }"
                  :y-axis="{ label: toAxisLabel(chart.config.z || chart.config.y) }"
                />
                <div v-else class="text-caption text-grey-7">No data</div>
              </div>
            </q-card-section>
          </q-card>
        </div>
      </q-card-section>
    </q-card>

    <q-dialog v-model="thumbnailPopupOpen">
      <q-card style="min-width: 900px; max-width: 96vw">
        <q-card-section class="row items-center">
          <div class="text-subtitle1">
            {{ selectedThumbnailChart?.title || 'Chart' }}
          </div>
          <q-space />
          <q-btn v-close-popup flat dense label="Close" />
        </q-card-section>
        <q-separator />
        <q-card-section v-if="selectedThumbnailChart" class="q-gutter-sm">
          <ObjectPathChartAxesEditor
            :config="selectedThumbnailConfig"
            :path-options="filteredPathOptions"
            @filter="filterPathOptions"
            @update:config="updateSelectedThumbnailConfig"
          />

          <ListChart
            v-if="selectedThumbnailChart.value !== undefined"
            :value="selectedThumbnailChart.value"
            :title="selectedThumbnailChart.title"
            :show-controls="true"
            :enable-data-zoom="true"
            :show-axis-ticks="true"
            :show-axis-units="true"
            :x-axis="{ label: toAxisLabel(selectedThumbnailChart.config.x) }"
            :y-axis="{ label: toAxisLabel(selectedThumbnailChart.config.z || selectedThumbnailChart.config.y) }"
          />
        </q-card-section>
      </q-card>
    </q-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import ListChart from './ListChart.vue'
import ObjectPathChartAxesEditor from './ObjectPathChartAxesEditor.vue'
import type { ObjectPathChartDefinition } from './ObjectPathChartAxesEditor.vue'

export type { ObjectPathChartDefinition }
export type ObjectPathChartsViewOptions = {
  viewMode?: 'full' | 'viewOnly' | 'thumbnail' | undefined
  minimalView?: boolean | undefined
}

const props = defineProps<{
  source?: Record<string, unknown> | null
}>()

const chartsModel = defineModel<ObjectPathChartDefinition[]>({ default: () => [] })
const optionsModel = defineModel<ObjectPathChartsViewOptions>('options', { default: () => ({}) })
const mode = computed<'full' | 'viewOnly' | 'thumbnail'>({
  get: () => {
    if (optionsModel.value.viewMode === 'full' || optionsModel.value.viewMode === 'thumbnail') {
      return optionsModel.value.viewMode
    }
    if (optionsModel.value.viewMode === 'viewOnly') return 'viewOnly'
    return optionsModel.value.minimalView ? 'viewOnly' : 'full'
  },
  set: (v) => {
    optionsModel.value = { ...optionsModel.value, viewMode: v, minimalView: undefined }
  },
})
const isViewOnly = computed(() => mode.value === 'viewOnly')
const thumbnailPopupOpen = ref(false)
const selectedThumbnailIndex = ref<number | null>(null)

type Option = { label: string; value: string }

const sourceObject = computed<Record<string, unknown> | null>(() => {
  const src = props.source
  if (!src || typeof src !== 'object' || Array.isArray(src)) return null
  return src
})

function isNumericArray(value: unknown): value is number[] {
  if (!Array.isArray(value)) return false
  return value.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
}

function collectNumericArrayPaths(root: Record<string, unknown> | null): string[] {
  if (!root) return []
  const out: string[] = []
  const seen = new WeakSet<object>()

  const walk = (value: unknown, path: string) => {
    if (Array.isArray(value)) {
      if (path && isNumericArray(value)) out.push(path)
      return
    }
    if (!value || typeof value !== 'object') return
    const obj = value as Record<string, unknown>
    if (seen.has(obj)) return
    seen.add(obj)
    for (const [k, v] of Object.entries(obj)) {
      walk(v, path ? `${path}.${k}` : k)
    }
  }

  walk(root, '')
  return out.sort((a, b) => a.localeCompare(b))
}

const pathOptions = computed<Option[]>(() =>
  collectNumericArrayPaths(sourceObject.value).map((path) => ({
    label: path,
    value: path,
  })),
)

const filteredPathOptions = ref<Option[]>([])
watch(
  pathOptions,
  (next) => {
    filteredPathOptions.value = next
  },
  { immediate: true },
)

function filterPathOptions(value: string, update: (fn: () => void) => void) {
  update(() => {
    const q = String(value || '')
      .trim()
      .toLowerCase()
    filteredPathOptions.value = !q
      ? pathOptions.value
      : pathOptions.value.filter((opt) => opt.label.toLowerCase().includes(q))
  })
}

function findDefaultXPath(paths: string[]): string {
  const exact = ['time', 'data.time', 't', 'data.t']
  for (const candidate of exact) {
    if (paths.includes(candidate)) return candidate
  }
  const fuzzy = paths.find((p) => /(?:^|\.)(time|t)$/i.test(p))
  if (fuzzy) return fuzzy
  return paths[0] ?? ''
}

function buildDefaultChart(): ObjectPathChartDefinition {
  const all = pathOptions.value.map((o) => o.value)
  const x = findDefaultXPath(all)
  const y = all.find((p) => p !== x) ?? ''
  return { x, ...(y ? { y } : {}) }
}

function addChartAndOpen() {
  const nextCharts = [...chartsModel.value, buildDefaultChart()]
  const newIndex = nextCharts.length - 1
  chartsModel.value = nextCharts
  void nextTick(() => {
    openThumbnailPopup(newIndex)
  })
}

function removeChart(index: number) {
  chartsModel.value = chartsModel.value.filter((_, i) => i !== index)
}

function updateChartConfig(index: number, next: ObjectPathChartDefinition) {
  chartsModel.value = chartsModel.value.map((cfg, i) => (i === index ? { ...next } : cfg))
}

watch(
  pathOptions,
  () => {
    if (chartsModel.value.length === 0 && pathOptions.value.length > 0) {
      chartsModel.value = [buildDefaultChart()]
    }
  },
  { immediate: true },
)

function getPathValue(root: Record<string, unknown> | null, path?: string): unknown {
  if (!root || !path) return undefined
  return path.split('.').reduce<unknown>((acc, key) => {
    if (!acc || typeof acc !== 'object') return undefined
    return (acc as Record<string, unknown>)[key]
  }, root)
}

function readSeries(path?: string): number[] | null {
  const value = getPathValue(sourceObject.value, path)
  return isNumericArray(value) ? value : null
}

function toAxisLabel(path?: string): string {
  if (!path) return ''
  const parts = path.split('.')
  return parts[parts.length - 1] || path
}

const chartList = computed(() =>
  chartsModel.value.map((config, index) => {
    const x = readSeries(config.x)
    const y = readSeries(config.y)
    const z = readSeries(config.z)
    const key = `${index}:${config.x || ''}:${config.y || ''}:${config.z || ''}:${config.title || ''}`

    const title =
      config.title ||
      (config.z && config.y && config.x
        ? `${config.z} over ${config.x} / ${config.y}`
        : config.y && config.x
          ? `${config.y} vs ${config.x}`
          : config.x || `Chart ${index + 1}`)

    if (x && y && z) {
      const len = Math.min(x.length, y.length, z.length)
      const points: Array<{ x: number; y: number; v: number }> = []
      for (let i = 0; i < len; i += 1) {
        points.push({ x: x[i]!, y: y[i]!, v: z[i]! })
      }
      return {
        key,
        config,
        title,
        value: {
          kind: 'xyv-heatmap' as const,
          xValues: Array.from(new Set(points.map((p) => p.x))),
          yValues: Array.from(new Set(points.map((p) => p.y))),
          points,
        },
      }
    }

    if (x && y) {
      const len = Math.min(x.length, y.length)
      return {
        key,
        config,
        title,
        value: {
          kind: 'xy-series' as const,
          xValues: x.slice(0, len),
          yValues: y.slice(0, len),
        },
      }
    }

    if (x) {
      return {
        key,
        config,
        title,
        value: x,
      }
    }

    return {
      key,
      config,
      title,
      value: undefined,
    }
  }),
)

const selectedThumbnailChart = computed(() => {
  if (!Number.isInteger(selectedThumbnailIndex.value)) return null
  const index = Number(selectedThumbnailIndex.value)
  if (index < 0 || index >= chartList.value.length) return null
  return chartList.value[index] ?? null
})

const selectedThumbnailConfig = computed<ObjectPathChartDefinition>(() => {
  if (!Number.isInteger(selectedThumbnailIndex.value)) return {}
  const index = Number(selectedThumbnailIndex.value)
  if (index < 0 || index >= chartsModel.value.length) return {}
  return chartsModel.value[index] ?? {}
})

function updateSelectedThumbnailConfig(next: ObjectPathChartDefinition) {
  if (!Number.isInteger(selectedThumbnailIndex.value)) return
  updateChartConfig(Number(selectedThumbnailIndex.value), next)
}

function openThumbnailPopup(index: number) {
  selectedThumbnailIndex.value = index
  thumbnailPopupOpen.value = true
}
</script>

<style scoped>
.object-path-charts {
  width: 100%;
  min-width: 0;
  max-width: 100%;
  overflow-x: hidden;
}

.object-path-charts__card {
  width: 100%;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
}

.object-path-charts__row {
  min-width: 0;
}

.object-path-charts__col {
  min-width: 0;
}

.object-path-charts__chart {
  width: 100%;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
}

.object-path-charts__thumb-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 8px;
}

.object-path-charts__thumb-card {
  width: 100%;
  min-width: 0;
  max-width: 100%;
  cursor: pointer;
}

.object-path-charts__thumb-chart {
  width: 100%;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
}

.object-path-charts__thumb-chart :deep(.list-chart) {
  pointer-events: none;
}

.object-path-charts__thumb-disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
