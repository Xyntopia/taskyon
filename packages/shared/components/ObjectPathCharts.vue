<template>
  <div class="object-path-charts column q-gutter-md">
    <div v-if="showControls" class="row items-center q-gutter-sm">
      <q-btn dense flat color="primary" label="Add Chart" @click="addChartAndOpen" />
      <q-btn
        v-if="props.showAddMapButton"
        dense
        flat
        color="primary"
        label="Add Map"
        @click="addMapAndOpen"
      />
      <q-btn
        dense
        flat
        color="primary"
        label="Auto Interesting"
        :disable="resolvedPathOptions.length < 2"
        @click="populateInterestingCharts"
      />
      <q-btn
        dense
        flat
        color="secondary"
        label="Update All Charts"
        :disable="chartList.length === 0"
        @click="updateAllCharts"
      />
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
      <q-badge v-if="lazyMode" color="orange-8" text-color="white" label="Lazy render" />
    </div>

    <q-card v-if="chartList.length === 0" flat bordered class="object-path-charts__card">
      <q-card-section class="text-caption text-grey-7">
        No charts or maps configured yet.
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
        <div class="row items-center">
          <div class="text-caption text-grey-7">{{ chart.title }}</div>
          <q-space />
          <q-btn
            v-if="showControls && !isViewOnly"
            flat
            dense
            color="secondary"
            icon="refresh"
            @click="updateChart(index)"
          />
          <q-btn
            v-if="showControls && !isViewOnly"
            flat
            dense
            color="primary"
            icon="table_view"
            @click="openTablePopup(index)"
          />
          <q-btn
            v-if="showControls"
            flat
            dense
            color="amber-8"
            :icon="isChartFavorite(chart.config) ? 'star' : 'star_outline'"
            @click="toggleChartFavorite(index, chart.config)"
          />
        </div>

        <ObjectPathChartAxesEditor
          v-if="chart.variant === 'plot' && !isViewOnly && showControls"
          :config="chart.config"
          :path-options="filteredPathOptions"
          :scalar-path-options="filteredScalarPathOptions"
          :array-path-options="filteredArrayPathOptions"
          :show-remove="true"
          @filter="filterPathOptions"
          @update:config="(next) => updateChartConfig(index, { ...next, kind: 'plot' })"
          @remove="removeChart(index)"
        />

        <ObjectPathChartMapEditor
          v-else-if="chart.variant === 'map' && !isViewOnly && showControls"
          :config="chart.config"
          :column-options="mapColumnOptions"
          :numeric-column-options="mapNumericColumnOptions"
          :array-numeric-column-options="mapArrayNumericColumnOptions"
          :detected-lat-path="mapDetectedCoordinatePaths.latPath"
          :detected-lon-path="mapDetectedCoordinatePaths.lonPath"
          :feature-path-options="mapFeaturePathOptions"
          :object-feature-path-options="mapObjectPathOptions"
          :plot-resolution-options="plotResolutionOptions"
          :show-remove="true"
          @update:config="(next) => updateChartConfig(index, { ...next, kind: 'map' })"
          @remove="removeChart(index)"
        />

        <div v-if="chart.variant === 'plot'" class="object-path-charts__chart">
          <div v-if="chart.renderState === 'rendering'" class="text-caption text-grey-7">
            Rendering chart...
          </div>
          <div v-else-if="chart.renderState === 'error'" class="text-caption text-negative">
            {{ chart.renderError || 'Failed to render chart.' }}
            <q-btn flat dense color="primary" label="Retry" @click="updateChart(index)" />
          </div>
          <template v-else-if="chart.plotValue !== undefined">
            <ListChart
              :value="chart.plotValue"
              :title="chart.title"
              :auto-contour-on-sparse-heatmap="props.autoContourOnSparseHeatmap"
              :show-controls="showControls && !isViewOnly"
              :enable-data-zoom="showControls && !isViewOnly"
              :show-axis-ticks="true"
              :show-axis-units="true"
              :x-axis="{ label: toAxisLabel(chart.config.x), unit: toAxisUnit(chart.config.x) }"
              :y-axis="{
                label: toAxisLabel(chart.config.y),
                unit: toAxisUnit(chart.config.y),
              }"
            />
          </template>
          <div v-else class="text-caption text-grey-7 q-gutter-xs row items-center">
            <span v-if="lazyMode">Large dataset: render on demand.</span>
            <span v-else>Pick valid axis paths to render this chart.</span>
            <q-btn
              v-if="canRenderChart(chart)"
              flat
              dense
              color="primary"
              label="Update"
              @click="updateChart(index)"
            />
          </div>
        </div>

        <div v-else class="object-path-charts__map">
          <div v-if="chart.renderState === 'rendering'" class="text-caption text-grey-7">
            Rendering map...
          </div>
          <div v-else-if="chart.renderState === 'error'" class="text-caption text-negative">
            {{ chart.renderError || 'Failed to render map.' }}
            <q-btn flat dense color="primary" label="Retry" @click="updateChart(index)" />
          </div>
          <EnvironmentMap
            v-else-if="chart.mapValue"
            class="object-path-charts__map-view"
            style="height: 420px"
            :initial-center="chart.mapValue.initialCenter"
            :initial-zoom="chart.mapValue.initialZoom"
            :external-feature-layers="chart.mapValue.layers"
            :show-zoom-to-marked-button="chart.config.showZoomToMarkedButton !== false"
            :zoom-to-marked-layer-ids="chart.config.zoomToMarkedLayerIds ?? []"
          />
          <div v-else class="text-caption text-grey-7 q-gutter-xs row items-center">
            <span v-if="lazyMode">Large dataset: render on demand.</span>
            <span v-else>Configure contour and/or feature paths to render this map.</span>
            <q-btn
              v-if="canRenderChart(chart)"
              flat
              dense
              color="primary"
              label="Update"
              @click="updateChart(index)"
            />
          </div>
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
            :class="{ 'object-path-charts__thumb-disabled': !hasChartData(chart) && !lazyMode }"
            @click="openThumbnailPopup(index)"
          >
            <q-card-section class="q-pa-xs">
              <div class="row items-center q-mb-xs">
                <q-space />
                <q-btn
                  v-if="showControls"
                  flat
                  dense
                  color="amber-8"
                  :icon="isChartFavorite(chart.config) ? 'star' : 'star_outline'"
                  @click.stop="toggleChartFavorite(index, chart.config)"
                />
              </div>

              <div class="object-path-charts__thumb-chart">
                <ListChart
                  v-if="chart.variant === 'plot' && chart.plotValue !== undefined"
                  :value="chart.plotValue"
                  :title="chart.title"
                  :auto-contour-on-sparse-heatmap="props.autoContourOnSparseHeatmap"
                  :show-controls="false"
                  :enable-data-zoom="false"
                  :show-axis-ticks="false"
                  :show-axis-units="false"
                  chart-height="150px"
                  :x-axis="{ label: toAxisLabel(chart.config.x), unit: toAxisUnit(chart.config.x) }"
                  :y-axis="{
                    label: toAxisLabel(chart.config.y),
                    unit: toAxisUnit(chart.config.y),
                  }"
                />

                <EnvironmentMap
                  v-else-if="chart.variant === 'map' && chart.mapValue"
                  class="object-path-charts__thumb-map"
                  style="height: 150px"
                  :initial-center="chart.mapValue.initialCenter"
                  :initial-zoom="chart.mapValue.initialZoom"
                  :external-feature-layers="chart.mapValue.layers"
                />

                <div
                  v-else
                  class="text-caption text-grey-7 row items-center justify-center q-gutter-xs"
                >
                  <span>{{ lazyMode ? 'Render on open' : 'No data' }}</span>
                </div>
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
            v-if="selectedThumbnailChart.variant === 'plot' && showControls && !isViewOnly"
            :config="selectedThumbnailConfig"
            :path-options="filteredPathOptions"
            :scalar-path-options="filteredScalarPathOptions"
            :array-path-options="filteredArrayPathOptions"
            @filter="filterPathOptions"
            @update:config="(next) => updateSelectedThumbnailConfig({ ...next, kind: 'plot' })"
          />

          <ObjectPathChartMapEditor
            v-else-if="showControls && !isViewOnly"
            :config="selectedThumbnailConfig"
            :column-options="mapColumnOptions"
            :numeric-column-options="mapNumericColumnOptions"
            :array-numeric-column-options="mapArrayNumericColumnOptions"
            :detected-lat-path="mapDetectedCoordinatePaths.latPath"
            :detected-lon-path="mapDetectedCoordinatePaths.lonPath"
            :feature-path-options="mapFeaturePathOptions"
            :object-feature-path-options="mapObjectPathOptions"
            :plot-resolution-options="plotResolutionOptions"
            @update:config="(next) => updateSelectedThumbnailConfig({ ...next, kind: 'map' })"
          />

          <div
            v-if="selectedThumbnailChart.renderState === 'rendering'"
            class="text-caption text-grey-7"
          >
            Rendering...
          </div>
          <div
            v-else-if="selectedThumbnailChart.renderState === 'error'"
            class="text-caption text-negative row items-center q-gutter-xs"
          >
            <span>{{ selectedThumbnailChart.renderError || 'Failed to render.' }}</span>
            <q-btn flat dense color="primary" label="Retry" @click="renderSelectedThumbnail" />
          </div>

          <ListChart
            v-else-if="
              selectedThumbnailChart.variant === 'plot' &&
              selectedThumbnailChart.plotValue !== undefined
            "
            :value="selectedThumbnailChart.plotValue"
            :title="selectedThumbnailChart.title"
            :auto-contour-on-sparse-heatmap="props.autoContourOnSparseHeatmap"
            :show-controls="showControls && !isViewOnly"
            :enable-data-zoom="showControls && !isViewOnly"
            :show-axis-ticks="true"
            :show-axis-units="true"
            :x-axis="{
              label: toAxisLabel(selectedThumbnailChart.config.x),
              unit: toAxisUnit(selectedThumbnailChart.config.x),
            }"
            :y-axis="{
              label: toAxisLabel(selectedThumbnailChart.config.y),
              unit: toAxisUnit(selectedThumbnailChart.config.y),
            }"
          />

          <EnvironmentMap
            v-else-if="selectedThumbnailChart.variant === 'map' && selectedThumbnailChart.mapValue"
            class="object-path-charts__map-view"
            style="height: 520px"
            :initial-center="selectedThumbnailChart.mapValue.initialCenter"
            :initial-zoom="selectedThumbnailChart.mapValue.initialZoom"
            :external-feature-layers="selectedThumbnailChart.mapValue.layers"
            :show-zoom-to-marked-button="
              selectedThumbnailChart.config.showZoomToMarkedButton !== false
            "
            :zoom-to-marked-layer-ids="selectedThumbnailChart.config.zoomToMarkedLayerIds ?? []"
          />

          <div v-else class="text-caption text-grey-7 row items-center q-gutter-xs">
            <span v-if="lazyMode">Large dataset: render on demand.</span>
            <span v-else>No data.</span>
            <q-btn
              v-if="canRenderChart(selectedThumbnailChart)"
              flat
              dense
              color="primary"
              label="Update"
              @click="renderSelectedThumbnail"
            />
          </div>
        </q-card-section>
      </q-card>
    </q-dialog>

    <q-dialog v-model="tablePopupOpen">
      <q-card style="min-width: 900px; max-width: 96vw">
        <q-card-section class="row items-center">
          <div class="text-subtitle1">
            {{ selectedTableChart?.title || 'Data table' }}
          </div>
          <q-space />
          <q-select
            v-model="tableRowsPerPage"
            dense
            outlined
            :options="[10, 25, 50, 100]"
            style="width: 110px"
          />
          <q-btn
            flat
            dense
            color="secondary"
            label="Download CSV"
            :disable="tableRowCount === 0"
            @click="downloadTableCsv"
          />
          <q-btn v-close-popup flat dense label="Close" />
        </q-card-section>
        <q-separator />

        <q-card-section>
          <q-banner v-if="tableErrorMessage" dense class="bg-warning q-mb-sm">
            {{ tableErrorMessage }}
          </q-banner>

          <q-table
            flat
            dense
            hide-bottom
            row-key="__rowIndex"
            :rows="tablePageRows"
            :columns="tableColumns"
            :pagination="{
              page: tablePage,
              rowsPerPage: tableRowsPerPage,
              rowsNumber: tableRowCount,
            }"
          />

          <div class="row items-center q-mt-md q-gutter-md">
            <div class="text-caption text-grey-7">
              Rows: {{ tableRowCount }}
            </div>
            <q-space />
            <q-pagination
              v-model="tablePage"
              :max="tableMaxPage"
              :max-pages="8"
              boundary-numbers
              direction-links
            />
          </div>
        </q-card-section>
      </q-card>
    </q-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import ListChart from './varViews/ListChart.vue'
import ObjectPathChartAxesEditor from './ObjectPathChartAxesEditor.vue'
import ObjectPathChartMapEditor from './ObjectPathChartMapEditor.vue'
import EnvironmentMap from 'src/components/EnvironmentMap.vue'
import type { PlotFlatRow, PlotResolution, PlotSparseHeatmapValue } from '../modules/plotMath'
import { buildPlotValueFromRows } from '../modules/plotMath'
import {
  buildContourLayerFromSparseHeatmap,
  buildFeatureValueLayer,
  pickCoordinatePaths,
  type MapExternalFeatureLayer,
} from '../modules/plotMapLayers'
import type { ObjectPathChartDefinition } from './ObjectPathChartAxesEditor.vue'
import {
  generateDefaultCandidates,
  rankInterestingPlots,
  type SimulationData,
} from '../modules/interestingPlots'
import { useSharedRunLogs } from '../modules/runLogs'
import {
  normalizeResolvedChartPayload,
  resolveObjectPathChartPayload,
} from './objectPathChartsResolver'
import { decodeQueryAxisKey, evaluateQueryAxisValue } from '../modules/queryPipeline'

export type { ObjectPathChartDefinition }
export type ObjectPathChartsViewOptions = {
  viewMode?: 'full' | 'viewOnly' | 'thumbnail' | undefined
  minimalView?: boolean | undefined
}

type Option = { label: string; value: string }
type SchemaPathKind = 'number_scalar' | 'number_array' | 'object' | 'feature' | 'other'
type SeriesMetaEntry = {
  valueUnit?: string
  axisLabel?: string
  axisUnit?: string
  indexLabels?: string[]
}

type MapChartValue = {
  layers: MapExternalFeatureLayer[]
  initialCenter: [number, number]
  initialZoom: number
}

type RenderState = 'idle' | 'rendering' | 'ready' | 'error'

type ChartPayload = {
  plotValue?: unknown
  mapValue?: MapChartValue
  tableData?: {
    columns: string[]
    rows: Array<Record<string, unknown>>
  }
  error?: string
}

export type ObjectPathChartsPlotResolverArgs = {
  chart: ObjectPathChartDefinition
  index: number
}

export type ObjectPathChartsMapResolverArgs = {
  chart: ObjectPathChartDefinition
  index: number
}

type ChartViewModel = {
  key: string
  config: ObjectPathChartDefinition
  title: string
  variant: 'plot' | 'map'
  renderState: RenderState
  renderError: string | null
  plotValue: unknown
  mapValue: MapChartValue | undefined
}

const plotResolutionOptions: Array<{ label: string; value: PlotResolution }> = [
  { label: 'Auto', value: 'auto' },
  { label: '8 x 8', value: 8 },
  { label: '12 x 12', value: 12 },
  { label: '16 x 16', value: 16 },
  { label: '24 x 24', value: 24 },
  { label: '32 x 32', value: 32 },
  { label: '48 x 48', value: 48 },
  { label: '64 x 64', value: 64 },
]

const props = withDefaults(
  defineProps<{
    source?: Record<string, unknown> | null
    mapRows?: PlotFlatRow[] | null
    mapRuns?: unknown[] | null
    pathUnits?: Record<string, string> | null
    pathOptions?: Option[] | null
    pathKindByPath?: Record<string, SchemaPathKind> | null
    seriesResolver?: ((path: string) => number[] | null) | null
    plotPayloadResolver?:
      | ((args: ObjectPathChartsPlotResolverArgs) => ChartPayload | Promise<ChartPayload>)
      | null
    mapPayloadResolver?:
      | ((args: ObjectPathChartsMapResolverArgs) => ChartPayload | Promise<ChartPayload>)
      | null
    autoContourOnSparseHeatmap?: boolean
    favoriteKeys?: string[] | null
    showAddMapButton?: boolean
    showControls?: boolean
    lazy?: boolean
  }>(),
  {
    showAddMapButton: true,
    showControls: true,
    lazy: false,
  },
)
const showControls = computed(() => props.showControls)
const lazyMode = computed(() => props.lazy === true)
const { appendChartsLog } = useSharedRunLogs()

const emit = defineEmits<{
  (e: 'toggle-favorite', payload: { index: number; chart: ObjectPathChartDefinition }): void
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
const tablePopupOpen = ref(false)
const selectedTableChartIndex = ref<number | null>(null)
const tablePage = ref(1)
const tableRowsPerPage = ref(25)

const sourceObject = computed<Record<string, unknown> | null>(() => {
  const src = props.source
  if (!src || typeof src !== 'object' || Array.isArray(src)) return null
  return src
})

const isSimpleObjectSeriesMode = computed(
  () => !!sourceObject.value && typeof props.seriesResolver !== 'function',
)

const mapRows = computed<PlotFlatRow[]>(() =>
  Array.isArray(props.mapRows)
    ? props.mapRows.filter((row): row is PlotFlatRow => !!row && typeof row === 'object')
    : [],
)

const mapRuns = computed<unknown[]>(() => (Array.isArray(props.mapRuns) ? props.mapRuns : []))

const dataEpoch = ref(0)
watch(
  [
    () => props.source,
    () => props.mapRows,
    () => props.mapRuns,
    () => props.pathOptions,
    () => props.pathKindByPath,
  ],
  () => {
    dataEpoch.value += 1
  },
  { deep: false },
)

const dataVersion = computed(() => {
  const pLen = props.pathOptions?.length ?? 0
  return `${dataEpoch.value}:${mapRows.value.length}:${mapRuns.value.length}:${pLen}:${chartsModel.value.length}`
})

const MAX_SERIES_CACHE = 200
const MAX_CHART_CACHE = 80
const seriesCache = new Map<string, number[] | null>()
const chartPayloadCache = new Map<string, ChartPayload>()
const renderStateByKey = ref<Record<string, RenderState>>({})
const renderErrorByKey = ref<Record<string, string | null>>({})
const renderPayloadByKey = ref<Record<string, ChartPayload>>({})

const boundedSet = <T,>(cache: Map<string, T>, key: string, value: T, max: number) => {
  if (cache.has(key)) cache.delete(key)
  cache.set(key, value)
  if (cache.size > max) {
    const oldest = cache.keys().next().value
    if (typeof oldest === 'string') cache.delete(oldest)
  }
}

const clearRenderCaches = () => {
  seriesCache.clear()
  renderStateByKey.value = Object.fromEntries(
    Object.entries(renderStateByKey.value).map(([key, value]) => [
      key,
      value === 'rendering' ? 'idle' : value,
    ]),
  )
}

watch(dataVersion, clearRenderCaches)

function isNumericArray(value: unknown): value is number[] {
  if (!Array.isArray(value)) return false
  return value.every((entry) => typeof entry === 'number')
}

const scannedPathOptions = ref<Option[]>([])
let sourceScanToken = 0

const scheduleChunk = (fn: () => void) => {
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    ;(window as unknown as { requestIdleCallback: (cb: () => void) => number }).requestIdleCallback(
      fn,
    )
  } else {
    setTimeout(fn, 0)
  }
}

watch(
  sourceObject,
  (root) => {
    sourceScanToken += 1
    const token = sourceScanToken

    if (!root) {
      scannedPathOptions.value = []
      return
    }

    scannedPathOptions.value = []

    const stack: Array<{ value: unknown; path: string }> = [{ value: root, path: '' }]
    const seen = new WeakSet<object>()
    const out = new Set<string>()

    const step = () => {
      if (token !== sourceScanToken) return
      let budget = 500
      while (budget > 0 && stack.length > 0) {
        budget -= 1
        const item = stack.pop()
        if (!item) continue

        const { value, path } = item
        if (Array.isArray(value)) {
          if (path && isNumericArray(value)) out.add(path)
          continue
        }
        if (!value || typeof value !== 'object') continue
        const obj = value as Record<string, unknown>
        if (seen.has(obj)) continue
        seen.add(obj)
        for (const [k, v] of Object.entries(obj)) {
          stack.push({ value: v, path: path ? `${path}.${k}` : k })
        }
      }

      scannedPathOptions.value = Array.from(out)
        .sort((a, b) => a.localeCompare(b))
        .map((path) => ({ label: path, value: path }))

      if (stack.length > 0) {
        scheduleChunk(step)
      }
    }

    step()
  },
  { immediate: true },
)

const normalizedProvidedPathOptions = computed<Option[]>(() => {
  const incoming = props.pathOptions
  if (!Array.isArray(incoming)) return []
  return incoming
    .map((item) => {
      const value = typeof item?.value === 'string' ? item.value : ''
      const label = typeof item?.label === 'string' && item.label.trim() ? item.label : value
      return value ? { label, value } : null
    })
    .filter((x): x is Option => !!x)
})

const resolvedPathOptions = computed<Option[]>(() =>
  normalizedProvidedPathOptions.value.length > 0
    ? normalizedProvidedPathOptions.value
    : scannedPathOptions.value,
)

const pathKindByPathResolved = computed<Record<string, SchemaPathKind>>(() => {
  const given = props.pathKindByPath
  if (given && typeof given === 'object') return given
  return {}
})

const pathKindOf = (path: string): SchemaPathKind => {
  const kind = pathKindByPathResolved.value[path]
  return kind ?? 'other'
}

const observedNumericKindsByPath = computed<Record<string, { scalar: boolean; array: boolean }>>(() => {
  if (mapRows.value.length === 0) return {}
  const out: Record<string, { scalar: boolean; array: boolean }> = {}
  const maxRows = Math.min(mapRows.value.length, 5000)
  for (let i = 0; i < maxRows; i += 1) {
    const row = mapRows.value[i]
    if (!row) continue
    for (const [path, value] of Object.entries(row)) {
      if (!out[path]) out[path] = { scalar: false, array: false }
      if (typeof value === 'number' && Number.isFinite(value)) {
        out[path].scalar = true
        continue
      }
      if (Array.isArray(value)) {
        const hasFinite = value.some((entry) => typeof entry === 'number' && Number.isFinite(entry))
        if (hasFinite) out[path].array = true
      }
    }
  }
  return out
})

const scalarNumericPathOptions = computed<Option[]>(() => {
  if (mapRows.value.length === 0) {
    return resolvedPathOptions.value.filter((opt) => pathKindOf(opt.value) === 'number_scalar')
  }
  const outByValue = new Map<string, Option>()
  for (const opt of resolvedPathOptions.value) {
    const kind = observedNumericKindsByPath.value[opt.value]
    if (kind?.scalar === true) outByValue.set(opt.value, opt)
  }
  for (const [path, kind] of Object.entries(observedNumericKindsByPath.value)) {
    if (kind.scalar !== true || outByValue.has(path)) continue
    outByValue.set(path, { label: path, value: path })
  }
  return Array.from(outByValue.values()).sort((a, b) => a.label.localeCompare(b.label))
})

const arrayNumericPathOptions = computed<Option[]>(() => {
  if (mapRows.value.length === 0) {
    return resolvedPathOptions.value.filter((opt) => pathKindOf(opt.value) === 'number_array')
  }
  const outByValue = new Map<string, Option>()
  for (const opt of resolvedPathOptions.value) {
    const kind = observedNumericKindsByPath.value[opt.value]
    if (kind?.array === true) outByValue.set(opt.value, opt)
  }
  for (const [path, kind] of Object.entries(observedNumericKindsByPath.value)) {
    if (kind.array !== true || outByValue.has(path)) continue
    outByValue.set(path, { label: path, value: path })
  }
  return Array.from(outByValue.values()).sort((a, b) => a.label.localeCompare(b.label))
})

const featurePathOptionsBySchema = computed<Option[]>(() =>
  resolvedPathOptions.value.filter((opt) => pathKindOf(opt.value) === 'feature'),
)

const objectPathOptionsBySchema = computed<Option[]>(() =>
  resolvedPathOptions.value.filter((opt) => pathKindOf(opt.value) === 'object'),
)

const mapColumnOptions = ref<Option[]>([])
const mapNumericColumnOptions = ref<Option[]>([])
let mapScanToken = 0

watch(
  [mapRows, lazyMode, scalarNumericPathOptions, resolvedPathOptions],
  ([rows, lazy]) => {
    mapScanToken += 1
    const token = mapScanToken

    if (rows.length === 0) {
      mapColumnOptions.value =
        scalarNumericPathOptions.value.length > 0
          ? scalarNumericPathOptions.value
          : resolvedPathOptions.value
      mapNumericColumnOptions.value = scalarNumericPathOptions.value
      return
    }

    const scanChunk = lazy && rows.length > 1000

    const keySet = new Set<string>()
    const numericSet = new Set<string>()
    let idx = 0

    const commit = () => {
      const scannedColumns = Array.from(keySet)
        .sort((a, b) => a.localeCompare(b))
        .map((key) => ({ label: key, value: key }))
      mapColumnOptions.value =
        scalarNumericPathOptions.value.length > 0 ? scalarNumericPathOptions.value : scannedColumns
      const scannedNumeric = Array.from(numericSet)
        .sort((a, b) => a.localeCompare(b))
        .map((key) => ({ label: key, value: key }))
      mapNumericColumnOptions.value =
        scalarNumericPathOptions.value.length > 0 ? scalarNumericPathOptions.value : scannedNumeric
    }

    const scanRows = (start: number, end: number) => {
      for (let i = start; i < end; i += 1) {
        const row = rows[i]
        if (!row) continue
        for (const [key, value] of Object.entries(row)) {
          keySet.add(key)
          const numeric =
            typeof value === 'number'
              ? value
              : typeof value === 'string'
                ? Number(value)
                : Number.NaN
          if (Number.isFinite(numeric)) numericSet.add(key)
        }
      }
    }

    if (!scanChunk) {
      scanRows(0, rows.length)
      commit()
      return
    }

    const step = () => {
      if (token !== mapScanToken) return
      const end = Math.min(idx + 400, rows.length)
      scanRows(idx, end)
      idx = end
      commit()
      if (idx < rows.length) {
        setTimeout(step, 0)
      }
    }

    step()
  },
  { immediate: true },
)

const mapFeaturePathOptions = computed<Option[]>(() => {
  if (featurePathOptionsBySchema.value.length > 0) return featurePathOptionsBySchema.value
  const out = new Set<string>()
  const visit = (value: unknown, prefix: string) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const rec = value as Record<string, unknown>
      if (rec.type === 'Feature' && rec.geometry && prefix) {
        out.add(prefix)
        return
      }
      for (const [key, child] of Object.entries(rec)) {
        const path = prefix ? `${prefix}.${key}` : key
        visit(child, path)
      }
    }
  }

  for (const run of mapRuns.value.slice(0, 30)) visit(run, '')

  return Array.from(out)
    .sort((a, b) => a.localeCompare(b))
    .map((path) => ({ label: path, value: path }))
})

const mapObjectPathOptions = computed<Option[]>(() => {
  if (objectPathOptionsBySchema.value.length > 0) return objectPathOptionsBySchema.value
  return []
})
const mapArrayNumericColumnOptions = computed<Option[]>(() => arrayNumericPathOptions.value)
const mapDetectedCoordinatePaths = computed(() =>
  pickCoordinatePaths(mapColumnOptions.value.map((option) => option.value)),
)

const filteredPathOptions = ref<Option[]>([])
const filteredScalarPathOptions = ref<Option[]>([])
const filteredArrayPathOptions = ref<Option[]>([])
watch(
  resolvedPathOptions,
  (next) => {
    filteredPathOptions.value = next
    filteredScalarPathOptions.value =
      scalarNumericPathOptions.value.length > 0 ? scalarNumericPathOptions.value : next
    filteredArrayPathOptions.value = arrayNumericPathOptions.value
  },
  { immediate: true },
)

function filterPathOptions(value: string, update: (fn: () => void) => void) {
  update(() => {
    const q = String(value || '')
      .trim()
      .toLowerCase()
    const filter = (options: Option[]) =>
      !q ? options : options.filter((opt) => opt.label.toLowerCase().includes(q))
    filteredPathOptions.value = filter(resolvedPathOptions.value)
    filteredScalarPathOptions.value = filter(
      scalarNumericPathOptions.value.length > 0
        ? scalarNumericPathOptions.value
        : resolvedPathOptions.value,
    )
    filteredArrayPathOptions.value = filter(arrayNumericPathOptions.value)
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
  const all = resolvedPathOptions.value.map((o) => o.value)
  const x = findDefaultXPath(all)
  const y = all.find((p) => p !== x) ?? ''
  return {
    kind: 'plot',
    plotMode: '2d',
    x,
    ...(y ? { y } : {}),
    xAxisTransform: { kind: 'scalar' },
    yAxisTransform: { kind: 'scalar' },
  }
}

function buildDefaultMap(): ObjectPathChartDefinition {
  const columnPaths = mapColumnOptions.value.map((o) => o.value)
  const detected = pickCoordinatePaths(columnPaths)
  return {
    kind: 'map',
    ...(detected.latPath ? { latPath: detected.latPath } : {}),
    ...(detected.lonPath ? { lonPath: detected.lonPath } : {}),
    ...(mapNumericColumnOptions.value[0]?.value
      ? { valuePath: mapNumericColumnOptions.value[0].value }
      : {}),
    ...(mapFeaturePathOptions.value[0]?.value
      ? { featurePath: mapFeaturePathOptions.value[0].value }
      : {}),
    ...(mapObjectPathOptions.value[0]?.value
      ? { objectFeaturePath: mapObjectPathOptions.value[0].value }
      : {}),
    showContour: true,
    showFeatures: true,
    resolution: 'auto',
  }
}

function addChartAndOpen() {
  const nextCharts = [...chartsModel.value, buildDefaultChart()]
  const newIndex = nextCharts.length - 1
  chartsModel.value = nextCharts
  void nextTick(() => {
    openThumbnailPopup(newIndex)
  })
}

function addMapAndOpen() {
  const nextCharts = [...chartsModel.value, buildDefaultMap()]
  const newIndex = nextCharts.length - 1
  chartsModel.value = nextCharts
  void nextTick(() => {
    openThumbnailPopup(newIndex)
  })
}

function readSeriesFromSource(path?: string): number[] | null {
  if (!path) return null
  const root = sourceObject.value
  if (!root) return null
  const value = getPathValue(root, path)
  if (!isNumericArray(value)) return null
  return value.map((entry) => (Number.isFinite(entry) ? entry : Number.NaN))
}

function resolveSeries(path?: string): number[] | null {
  if (!path) return null
  const cacheKey = `${dataVersion.value}:${path}`
  if (seriesCache.has(cacheKey)) return seriesCache.get(cacheKey) ?? null

  let out: number[] | null = null
  if (typeof props.seriesResolver === 'function') {
    const resolved = props.seriesResolver(path)
    out = Array.isArray(resolved) ? resolved : null
  } else {
    out = readSeriesFromSource(path)
  }

  boundedSet(seriesCache, cacheKey, out, MAX_SERIES_CACHE)
  return out
}

function buildSimulationDataFromSource(): SimulationData {
  const out: SimulationData = {}
  for (const path of resolvedPathOptions.value.map((opt) => opt.value)) {
    const series = resolveSeries(path)
    if (!series || series.length === 0) continue
    out[path] = series
  }
  return out
}

function candidateToTitle(
  rank: number,
  candidate: { x: string; y: string },
  reason?: string,
): string {
  const base = `${candidate.y} vs ${candidate.x}`
  if (!reason) return `#${rank + 1} ${base}`
  return `#${rank + 1} ${base} (${reason})`
}

function populateInterestingCharts() {
  const simulationData = buildSimulationDataFromSource()
  const candidates = generateDefaultCandidates(simulationData, {
    maxVariablesByVariance: 14,
    maxPairs: 48,
  })
  const ranked = rankInterestingPlots(simulationData, candidates, {
    profile: 'balanced',
    thresholds: { minSamples: 16, minScore: 0.08 },
  })
  const top = ranked.slice(0, 8)
  if (top.length === 0) return

  chartsModel.value = top.map((entry, index) => ({
    kind: 'plot',
    x: entry.candidate.x,
    y: entry.candidate.y,
    title: candidateToTitle(index, entry.candidate, entry.reasons[0]),
  }))
}

function removeChart(index: number) {
  chartsModel.value = chartsModel.value.filter((_, i) => i !== index)
}

function updateChartConfig(index: number, next: ObjectPathChartDefinition) {
  chartsModel.value = chartsModel.value.map((cfg, i) => (i === index ? { ...next } : cfg))
}

function getPathValue(root: unknown, path?: string): unknown {
  if (!root || typeof root !== 'object' || !path) return undefined
  let current: unknown = root
  let remaining = String(path)

  while (remaining.length > 0) {
    if (!current || typeof current !== 'object') return undefined
    const obj = current as Record<string, unknown>

    if (Object.prototype.hasOwnProperty.call(obj, remaining)) return obj[remaining]

    const keys = Object.keys(obj)
    let matchedKey = ''
    for (const key of keys) {
      if (remaining === key || remaining.startsWith(`${key}.`)) {
        if (key.length > matchedKey.length) matchedKey = key
      }
    }

    if (!matchedKey) return undefined
    const value = obj[matchedKey]
    if (remaining === matchedKey) return value
    current = value
    remaining = remaining.slice(matchedKey.length + 1)
  }

  return current
}

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

const toDisplayValue = (value: unknown): string | number | boolean | null => {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  try {
    return JSON.stringify(value)
  } catch {
    return '[unserializable]'
  }
}

function computeMapInitialCenter(latPath?: string, lonPath?: string): [number, number] {
  if (!latPath || !lonPath || mapRows.value.length === 0) return [39.5, -98.35]
  const pts = mapRows.value
    .map((row) => {
      const lat = toFiniteNumber(row[latPath])
      const lon = toFiniteNumber(row[lonPath])
      return lat != null && lon != null ? ([lat, lon] as const) : null
    })
    .filter((p): p is readonly [number, number] => p !== null)

  if (pts.length === 0) return [39.5, -98.35]
  const lat = pts.reduce((sum, p) => sum + p[0], 0) / pts.length
  const lon = pts.reduce((sum, p) => sum + p[1], 0) / pts.length
  return [lat, lon]
}

function computeMapInitialZoom(latPath?: string, lonPath?: string): number {
  if (!latPath || !lonPath || mapRows.value.length === 0) return 4

  const pts = mapRows.value
    .map((row) => {
      const lat = toFiniteNumber(row[latPath])
      const lon = toFiniteNumber(row[lonPath])
      return lat != null && lon != null ? ([lat, lon] as const) : null
    })
    .filter((p): p is readonly [number, number] => p !== null)

  if (pts.length < 2) return 13
  const lats = pts.map((p) => p[0])
  const lons = pts.map((p) => p[1])
  const span = Math.max(
    Math.max(...lats) - Math.min(...lats),
    Math.max(...lons) - Math.min(...lons),
  )

  if (span < 0.01) return 15
  if (span < 0.05) return 13
  if (span < 0.2) return 11
  if (span < 1) return 9
  if (span < 5) return 7
  return 4
}

const seriesMetaByPath = computed<Record<string, SeriesMetaEntry>>(() => {
  const out: Record<string, SeriesMetaEntry> = {}
  for (const run of mapRuns.value.slice(0, 100)) {
    if (!run || typeof run !== 'object') continue
    const rec = run as Record<string, unknown>
    const outputs = rec.outputs
    if (!outputs || typeof outputs !== 'object') continue
    const metaRaw = (outputs as Record<string, unknown>).meta
    if (!metaRaw || typeof metaRaw !== 'object') continue
    const seriesRaw = (metaRaw as Record<string, unknown>).series
    if (!seriesRaw || typeof seriesRaw !== 'object') continue
    for (const [path, val] of Object.entries(seriesRaw as Record<string, unknown>)) {
      if (!val || typeof val !== 'object' || Array.isArray(val)) continue
      const meta = val as Record<string, unknown>
      const next: SeriesMetaEntry = {}
      if (typeof meta.valueUnit === 'string') next.valueUnit = meta.valueUnit
      if (typeof meta.axisLabel === 'string') next.axisLabel = meta.axisLabel
      if (typeof meta.axisUnit === 'string') next.axisUnit = meta.axisUnit
      if (Array.isArray(meta.indexLabels)) {
        next.indexLabels = meta.indexLabels.filter((x): x is string => typeof x === 'string')
      }
      out[path] = next
    }
  }
  return out
})

const metaForPath = (path?: string): SeriesMetaEntry | null => {
  if (!path) return null
  const direct = seriesMetaByPath.value[path]
  if (direct) return direct
  if (path.startsWith('outputs.')) {
    return seriesMetaByPath.value[path.slice('outputs.'.length)] ?? null
  }
  const prefixed = seriesMetaByPath.value[`outputs.${path}`]
  return prefixed ?? null
}

function toAxisLabel(path?: string): string {
  if (!path) return ''
  const axis = decodeQueryAxisKey(path)
  const rawPath = axis?.path ?? path
  const meta = metaForPath(rawPath)
  const baseLabel = meta?.axisLabel?.trim()
    ? meta.axisLabel.trim()
    : (() => {
        const parts = rawPath.split('.')
        return parts[parts.length - 1] || rawPath
      })()
  if (!axis || axis.op === 'identity' || axis.op == null) return baseLabel
  if (axis.op === 'index') return `${baseLabel} [${axis.index ?? 0}]`
  return `${baseLabel} (${axis.op})`
}

function toAxisUnit(path?: string): string {
  if (!path) return ''
  const axis = decodeQueryAxisKey(path)
  const rawPath = axis?.path ?? path
  const meta = metaForPath(rawPath)
  if (meta?.valueUnit?.trim()) return meta.valueUnit.trim()
  if (meta?.axisUnit?.trim()) return meta.axisUnit.trim()
  const units = props.pathUnits
  if (!units || typeof units !== 'object') return ''
  const raw = units[rawPath]
  if (typeof raw !== 'string') return ''
  return raw.trim()
}

type ResolvedMapValuePath = {
  sourcePath: string
  resolvedPath: string
  rows: PlotFlatRow[]
  runs: unknown[]
  transformed: boolean
}

type MapValueTransform =
  | { kind: 'scalar' }
  | { kind: 'aggregate'; op: 'mean' | 'sum' | 'min' | 'max' }
  | { kind: 'index'; index: number }

const resolveMapValueTransform = (
  chartConfig: ObjectPathChartDefinition,
): { sourcePath: string | null; transform: MapValueTransform } => {
  const rawPath = chartConfig.valuePath
  if (!rawPath) return { sourcePath: null, transform: { kind: 'scalar' } }
  const legacyAxis = decodeQueryAxisKey(rawPath)
  const sourcePath = legacyAxis?.path ?? rawPath
  const explicit = chartConfig.valueAxisTransform
  if (explicit?.kind === 'aggregate') {
    const op = explicit.op === 'sum' || explicit.op === 'min' || explicit.op === 'max' ? explicit.op : 'mean'
    return { sourcePath, transform: { kind: 'aggregate', op } }
  }
  if (explicit?.kind === 'index') {
    const index =
      typeof explicit.index === 'number' && Number.isInteger(explicit.index) && explicit.index >= 0
        ? explicit.index
        : 0
    return { sourcePath, transform: { kind: 'index', index } }
  }
  if (explicit?.kind === 'scalar') return { sourcePath, transform: { kind: 'scalar' } }
  if (!legacyAxis || (legacyAxis.op ?? 'identity') === 'identity') {
    return { sourcePath, transform: { kind: 'scalar' } }
  }
  if (legacyAxis.op === 'index') {
    const index =
      typeof legacyAxis.index === 'number' && Number.isInteger(legacyAxis.index) && legacyAxis.index >= 0
        ? legacyAxis.index
        : 0
    return { sourcePath, transform: { kind: 'index', index } }
  }
  return {
    sourcePath,
    transform: { kind: 'aggregate', op: legacyAxis.op === 'sum' || legacyAxis.op === 'min' || legacyAxis.op === 'max' ? legacyAxis.op : 'mean' },
  }
}

const resolveMapValuePath = (
  chartConfig: ObjectPathChartDefinition,
  fallbackValuePath?: string,
): ResolvedMapValuePath | null => {
  const effectiveConfig: ObjectPathChartDefinition =
    chartConfig.valuePath || !fallbackValuePath
      ? chartConfig
      : { ...chartConfig, valuePath: fallbackValuePath }
  const { sourcePath, transform } = resolveMapValueTransform(effectiveConfig)
  if (!sourcePath) return null
  if (transform.kind === 'scalar') {
    return {
      sourcePath,
      resolvedPath: sourcePath,
      rows: mapRows.value,
      runs: mapRuns.value,
      transformed: false,
    }
  }
  const resolvedPath = '__map_value_resolved__'
  const axisInput =
    transform.kind === 'aggregate'
      ? { path: sourcePath, op: transform.op }
      : { path: sourcePath, op: 'index' as const, index: transform.index }
  const rows = mapRows.value.map((row) => ({
    ...row,
    [resolvedPath]: evaluateQueryAxisValue(row[sourcePath], axisInput),
  }))
  const runs = mapRuns.value.map((run) => {
    if (!run || typeof run !== 'object') return run
    return {
      ...(run as Record<string, unknown>),
      [resolvedPath]: evaluateQueryAxisValue(getPathValue(run, sourcePath), axisInput),
    }
  })
  return {
    sourcePath,
    resolvedPath,
    rows,
    runs,
    transformed: true,
  }
}

const mapValueLabel = (chartConfig: ObjectPathChartDefinition): string => {
  const { sourcePath, transform } = resolveMapValueTransform(chartConfig)
  const base = toAxisLabel(sourcePath ?? undefined) || 'value'
  if (transform.kind === 'aggregate') return `${base} (${transform.op})`
  if (transform.kind === 'index') return `${base} [${transform.index}]`
  return base
}

const axisTransformKey = (
  transform?: { kind?: unknown; op?: unknown; index?: unknown },
): string => {
  if (!transform || typeof transform !== 'object') return 'scalar'
  const kind =
    transform.kind === 'aggregate' || transform.kind === 'index' ? transform.kind : 'scalar'
  if (kind === 'aggregate') {
    const op =
      transform.op === 'sum' || transform.op === 'min' || transform.op === 'max'
        ? transform.op
        : 'mean'
    return `agg:${op}`
  }
  if (kind === 'index') {
    const idx =
      typeof transform.index === 'number' && Number.isInteger(transform.index) && transform.index >= 0
        ? transform.index
        : 0
    return `idx:${idx}`
  }
  return 'scalar'
}

function chartFavoriteKey(chart: ObjectPathChartDefinition): string {
  const kind = chart.kind ?? 'plot'
  if (kind === 'map') {
    return [
      kind,
      chart.latPath ?? '',
      chart.lonPath ?? '',
      chart.valuePath ?? '',
      axisTransformKey(chart.valueAxisTransform),
      chart.featurePath ?? '',
      chart.objectFeaturePath ?? '',
      chart.showContour === false ? '0' : '1',
      chart.showFeatures === false ? '0' : '1',
      String(chart.resolution ?? 'auto'),
      chart.title ?? '',
    ].join('|')
  }
  return [
    kind,
    chart.plotMode ?? '2d',
    chart.x ?? '',
    chart.y ?? '',
    chart.z ?? '',
    axisTransformKey(chart.xAxisTransform),
    axisTransformKey(chart.yAxisTransform),
    axisTransformKey(chart.zAxisTransform),
    chart.title ?? '',
  ].join('|')
}

const favoriteKeySet = computed(() => new Set((props.favoriteKeys ?? []).filter((x) => !!x)))

function isChartFavorite(chart: ObjectPathChartDefinition): boolean {
  return favoriteKeySet.value.has(chartFavoriteKey(chart))
}

function toggleChartFavorite(index: number, chart: ObjectPathChartDefinition) {
  emit('toggle-favorite', { index, chart: { ...chart } })
}

const chartKeyAt = (index: number, config: ObjectPathChartDefinition): string => {
  const variant = config.kind === 'map' ? 'map' : 'plot'
  return variant === 'map'
    ? `${index}:map:${config.latPath || ''}:${config.lonPath || ''}:${config.valuePath || ''}:${axisTransformKey(config.valueAxisTransform)}:${config.featurePath || ''}:${config.objectFeaturePath || ''}:${config.showContour === false ? '0' : '1'}:${config.showFeatures === false ? '0' : '1'}:${config.resolution || 'auto'}:${config.title || ''}`
    : `${index}:plot:${config.plotMode || '2d'}:${config.x || ''}:${config.y || ''}:${config.z || ''}:${axisTransformKey(config.xAxisTransform)}:${axisTransformKey(config.yAxisTransform)}:${axisTransformKey(config.zAxisTransform)}:${config.title || ''}`
}

const chartList = computed<ChartViewModel[]>(() =>
  chartsModel.value.map((config, index) => {
    const variant = config.kind === 'map' ? 'map' : 'plot'
    const key = chartKeyAt(index, config)
    const payload = renderPayloadByKey.value[key] ?? {}
    const renderState = renderStateByKey.value[key] ?? 'idle'
    const renderError = renderErrorByKey.value[key] ?? payload.error ?? null

    const title =
      config.title ||
      (variant === 'map'
        ? `Map ${index + 1}`
        : config.z && config.y && config.x
          ? `${config.z} over ${config.x} / ${config.y}`
          : config.y && config.x
            ? `${config.y} vs ${config.x}`
            : config.x || `Chart ${index + 1}`)

    return {
      key,
      config,
      title,
      variant,
      renderState,
      renderError,
      plotValue: payload.plotValue,
      mapValue: payload.mapValue,
    }
  }),
)

const ensureRenderState = (key: string) => {
  if (!renderStateByKey.value[key]) renderStateByKey.value[key] = 'idle'
  if (!(key in renderErrorByKey.value)) renderErrorByKey.value[key] = null
}

const chartIdentityList = computed(() =>
  chartsModel.value.map((config, index) => ({
    index,
    key: chartKeyAt(index, config),
  })),
)

watch(
  chartIdentityList,
  (chartIdentity) => {
    const valid = new Set(chartIdentity.map((c) => c.key))

    const nextState: Record<string, RenderState> = {}
    const nextErr: Record<string, string | null> = {}
    const nextPayload: Record<string, ChartPayload> = {}

    for (const [key, state] of Object.entries(renderStateByKey.value)) {
      if (valid.has(key)) nextState[key] = state
    }
    for (const [key, err] of Object.entries(renderErrorByKey.value)) {
      if (valid.has(key)) nextErr[key] = err
    }
    for (const [key, payload] of Object.entries(renderPayloadByKey.value)) {
      if (valid.has(key)) nextPayload[key] = payload
    }

    renderStateByKey.value = nextState
    renderErrorByKey.value = nextErr
    renderPayloadByKey.value = nextPayload

    for (const chart of chartIdentity) {
      ensureRenderState(chart.key)
      const cacheKey = `${dataVersion.value}:${chart.key}`
      const cached = chartPayloadCache.get(cacheKey)
      if (!cached) continue
      renderPayloadByKey.value[chart.key] = cached
      renderStateByKey.value[chart.key] = 'ready'
      renderErrorByKey.value[chart.key] = cached.error ?? null
    }
  },
  { immediate: true },
)

const canRenderChart = (chart: ChartViewModel | null | undefined): boolean => {
  if (!chart) return false
  if (chart.variant === 'plot') {
    return !!chart.config.x || !!chart.config.y || !!chart.config.z
  }
  const columnPaths = mapColumnOptions.value.map((o) => o.value)
  const detected = pickCoordinatePaths(columnPaths)
  const latPath = chart.config.latPath ?? detected.latPath ?? undefined
  const lonPath = chart.config.lonPath ?? detected.lonPath ?? undefined
  const valuePath = chart.config.valuePath ?? mapNumericColumnOptions.value[0]?.value
  const resolvedValuePath = resolveMapValuePath(chart.config, valuePath)
  const featurePath = chart.config.featurePath ?? mapFeaturePathOptions.value[0]?.value
  const objectFeaturePath = chart.config.objectFeaturePath ?? mapObjectPathOptions.value[0]?.value
  const showContour = chart.config.showContour !== false
  const showFeatures = chart.config.showFeatures !== false
  return (
    (showContour && !!latPath && !!lonPath && !!resolvedValuePath) ||
    (showFeatures && !!featurePath && (!!resolvedValuePath || !!objectFeaturePath))
  )
}

const buildPlotPayload = (chart: ChartViewModel): ChartPayload => {
  const x = resolveSeries(chart.config.x)
  const y = resolveSeries(chart.config.y)
  const z = resolveSeries(chart.config.z)
  const plotMode = chart.config.plotMode ?? (chart.config.z ? 'heatmap' : '2d')

  // In simple source-object mode, keep plotting strictly path->series.
  // Aggregation transforms are resolved in the live query resolver.
  if (isSimpleObjectSeriesMode.value) {
    if (plotMode === 'heatmap' && x && y && z) {
      const len = Math.min(x.length, y.length, z.length)
      const points: Array<{ x: number; y: number; v: number }> = []
      for (let i = 0; i < len; i += 1) points.push({ x: x[i]!, y: y[i]!, v: z[i]! })
      return {
        plotValue: {
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
        plotValue: {
          kind: 'xy-series' as const,
          xValues: x.slice(0, len),
          yValues: y.slice(0, len),
        },
      }
    }
    if (x) return { plotValue: x }
    if (y) return { plotValue: y }
    return {}
  }

  if (plotMode === 'heatmap' && x && y && z) {
    const len = Math.min(x.length, y.length, z.length)
    const points: Array<{ x: number; y: number; v: number }> = []
    for (let i = 0; i < len; i += 1) {
      points.push({ x: x[i]!, y: y[i]!, v: z[i]! })
    }
    return {
      plotValue: {
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
      plotValue: {
        kind: 'xy-series' as const,
        xValues: x.slice(0, len),
        yValues: y.slice(0, len),
      },
    }
  }

  if (x) return { plotValue: x }
  if (y) return { plotValue: y }

  return {}
}

const buildMapPayload = (chart: ChartViewModel, index: number): ChartPayload => {
  const columnPaths = mapColumnOptions.value.map((o) => o.value)
  const detected = pickCoordinatePaths(columnPaths)
  const latPath = chart.config.latPath ?? detected.latPath ?? undefined
  const lonPath = chart.config.lonPath ?? detected.lonPath ?? undefined
  const valuePath = chart.config.valuePath ?? mapNumericColumnOptions.value[0]?.value
  const resolvedValuePath = resolveMapValuePath(chart.config, valuePath)
  const featurePath = chart.config.featurePath ?? mapFeaturePathOptions.value[0]?.value
  const objectFeaturePath = chart.config.objectFeaturePath ?? mapObjectPathOptions.value[0]?.value
  const showContour = chart.config.showContour !== false
  const showFeatures = chart.config.showFeatures !== false
  const resolution = chart.config.resolution ?? 'auto'

  const layers: MapExternalFeatureLayer[] = []
  let contourData: PlotSparseHeatmapValue | null = null

  if (resolvedValuePath) {
    const kind = pathKindOf(resolvedValuePath.sourcePath)
    const isAllowed =
      kind === 'other' ||
      kind === 'number_scalar' ||
      (resolvedValuePath.transformed && kind === 'number_array')
    if (!isAllowed) {
      return {
        error: `Map value path "${resolvedValuePath.sourcePath}" must be scalar numeric (or aggregated from an array).`,
      }
    }
  }

  if (showContour && latPath && lonPath && resolvedValuePath) {
    const v = buildPlotValueFromRows(
      resolvedValuePath.rows,
      lonPath,
      latPath,
      resolvedValuePath.resolvedPath,
      { resolution },
    )
    contourData =
      v && typeof v === 'object' && !Array.isArray(v) && v.kind === 'xyv-heatmap' ? v : null
  }
  if (contourData) {
    const layer = buildContourLayerFromSparseHeatmap(contourData, `contour-${index}`)
    if (layer) layers.push(layer)
  }

  if (
    showFeatures &&
    featurePath &&
    (resolvedValuePath || objectFeaturePath) &&
    mapRuns.value.length > 0
  ) {
    const layer = buildFeatureValueLayer(
      resolvedValuePath?.runs ?? mapRuns.value,
      featurePath,
      resolvedValuePath?.resolvedPath ?? '',
      getPathValue,
      `features-${index}`,
      '__plotValue',
      objectFeaturePath,
    )
    if (layer) layers.push(layer)
  }

  if (layers.length === 0) return {}

  return {
    mapValue: {
      layers,
      initialCenter: computeMapInitialCenter(latPath, lonPath),
      initialZoom: computeMapInitialZoom(latPath, lonPath),
    },
  }
}

const renderChart = async (index: number, opts?: { force?: boolean }) => {
  const chart = chartList.value[index]
  if (!chart || !canRenderChart(chart)) return

  ensureRenderState(chart.key)
  if (renderStateByKey.value[chart.key] === 'rendering') return

  const cacheKey = `${dataVersion.value}:${chart.key}`
  if (opts?.force) chartPayloadCache.delete(cacheKey)
  const cached = chartPayloadCache.get(cacheKey)
  if (cached) {
    renderPayloadByKey.value[chart.key] = cached
    renderStateByKey.value[chart.key] = 'ready'
    renderErrorByKey.value[chart.key] = cached.error ?? null
    return
  }

  renderStateByKey.value[chart.key] = 'rendering'
  renderErrorByKey.value[chart.key] = null

  await new Promise<void>((resolve) => setTimeout(resolve, 0))

  try {
    const payload = (await resolveObjectPathChartPayload({
      variant: chart.variant,
      chart: chart.config,
      index,
      buildPlotPayload: () => buildPlotPayload(chart),
      buildMapPayload: () => buildMapPayload(chart, index),
      plotPayloadResolver: props.plotPayloadResolver ?? null,
      mapPayloadResolver: props.mapPayloadResolver ?? null,
    })) as ChartPayload
    const normalizedPayload = normalizeResolvedChartPayload(chart.variant, payload) as ChartPayload
    const normalizedError =
      typeof normalizedPayload.error === 'string' && normalizedPayload.error.length > 0
        ? normalizedPayload.error
        : null
    renderPayloadByKey.value[chart.key] = normalizedPayload
    boundedSet(chartPayloadCache, cacheKey, normalizedPayload, MAX_CHART_CACHE)
    renderStateByKey.value[chart.key] = normalizedError ? 'error' : 'ready'
    renderErrorByKey.value[chart.key] = normalizedError
    if (normalizedError) {
      appendChartsLog(`Chart render failed: ${normalizedError}`, {
        variant: chart.variant,
        chartIndex: index,
        chartConfig: chart.config,
      })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    renderPayloadByKey.value[chart.key] = { error: message }
    renderStateByKey.value[chart.key] = 'error'
    renderErrorByKey.value[chart.key] = message
    appendChartsLog(`Chart render exception: ${message}`, {
      variant: chart.variant,
      chartIndex: index,
      chartConfig: chart.config,
    })
  }
}

const hydrateChartFromCache = (index: number): boolean => {
  const chart = chartList.value[index]
  if (!chart) return false
  const cacheKey = `${dataVersion.value}:${chart.key}`
  const cached = chartPayloadCache.get(cacheKey)
  if (!cached) return false
  renderPayloadByKey.value[chart.key] = cached
  renderStateByKey.value[chart.key] = 'ready'
  renderErrorByKey.value[chart.key] = cached.error ?? null
  return true
}

const updateChart = async (index: number) => {
  await renderChart(index, { force: true })
}

const updateAllCharts = async () => {
  for (let i = 0; i < chartList.value.length; i += 1) {
    await updateChart(i)
  }
}

const selectedThumbnailChart = computed<ChartViewModel | null>(() => {
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
  const chart = selectedThumbnailChart.value
  if (chart) {
    renderStateByKey.value[chart.key] = 'idle'
    renderErrorByKey.value[chart.key] = null
    delete renderPayloadByKey.value[chart.key]
  }
}

function openThumbnailPopup(index: number) {
  selectedThumbnailIndex.value = index
  thumbnailPopupOpen.value = true
  hydrateChartFromCache(index)
}

function renderSelectedThumbnail() {
  if (!Number.isInteger(selectedThumbnailIndex.value)) return
  void updateChart(Number(selectedThumbnailIndex.value))
}

function hasChartData(chart: ChartViewModel): boolean {
  if (chart.variant === 'map') return !!chart.mapValue
  return chart.plotValue !== undefined
}

const selectedTableChart = computed<ChartViewModel | null>(() => {
  if (!Number.isInteger(selectedTableChartIndex.value)) return null
  const index = Number(selectedTableChartIndex.value)
  if (index < 0 || index >= chartList.value.length) return null
  return chartList.value[index] ?? null
})

const selectedTableData = computed<{ columns: string[]; rows: Array<Record<string, unknown>> } | null>(
  () => {
    const chart = selectedTableChart.value
    if (!chart) return null
    const payload = renderPayloadByKey.value[chart.key]
    if (!payload?.tableData) return null
    return payload.tableData
  },
)

const tableErrorMessage = computed<string | null>(() => {
  const chart = selectedTableChart.value
  if (!chart) return null
  const payloadError = renderPayloadByKey.value[chart.key]?.error
  const renderError = renderErrorByKey.value[chart.key]
  if (typeof renderError === 'string' && renderError.length > 0) return renderError
  if (typeof payloadError === 'string' && payloadError.length > 0) return payloadError
  return null
})

const tableRowCount = computed(() => {
  const tableData = selectedTableData.value
  if (tableData) return tableData.rows.length

  const chart = selectedTableChart.value
  if (!chart) return 0
  if (chart.variant === 'map') return mapRows.value.length

  const lengths = [chart.config.x, chart.config.y, chart.config.z]
    .map((path) => resolveSeries(path)?.length ?? 0)
    .filter((len) => len > 0)
  if (lengths.length === 0) return 0
  return Math.max(...lengths)
})

const tableMaxPage = computed(() => {
  const max = Math.ceil(tableRowCount.value / Math.max(1, tableRowsPerPage.value))
  return Math.max(1, max)
})

watch([tableRowCount, tableRowsPerPage], () => {
  if (tablePage.value > tableMaxPage.value) tablePage.value = tableMaxPage.value
})

const tableColumns = computed<
  Array<{ name: string; label: string; field: string; align?: 'left' | 'right' | 'center' }>
>(() => {
    const tableData = selectedTableData.value
    if (tableData) {
      return tableData.columns.map((field) => ({ name: field, label: field, field }))
    }

    const chart = selectedTableChart.value
    if (!chart) return []

    const base = [{ name: '__rowIndex', label: '#', field: '__rowIndex' }]
    if (chart.variant === 'map') {
      return [
        ...base,
        { name: 'lat', label: chart.config.latPath ?? 'lat', field: 'lat' },
        { name: 'lon', label: chart.config.lonPath ?? 'lon', field: 'lon' },
        { name: 'value', label: mapValueLabel(chart.config), field: 'value' },
        { name: 'feature', label: chart.config.featurePath ?? 'feature', field: 'feature' },
        {
          name: 'objectFeature',
          label: chart.config.objectFeaturePath ?? 'objectFeature',
          field: 'objectFeature',
        },
      ]
    }

    return [
      ...base,
      { name: 'x', label: chart.config.x ?? 'x', field: 'x' },
      { name: 'y', label: chart.config.y ?? 'y', field: 'y' },
      { name: 'z', label: chart.config.z ?? 'z', field: 'z' },
    ]
  },
)

const tablePageRows = computed<Array<Record<string, unknown>>>(() => {
  const tableData = selectedTableData.value
  if (tableData) {
    const start = (tablePage.value - 1) * tableRowsPerPage.value
    const end = Math.min(tableData.rows.length, start + tableRowsPerPage.value)
    return tableData.rows.slice(start, end)
  }

  const chart = selectedTableChart.value
  if (!chart || tableRowCount.value === 0) return []

  const start = (tablePage.value - 1) * tableRowsPerPage.value
  const end = Math.min(tableRowCount.value, start + tableRowsPerPage.value)
  return buildFallbackTableRows(chart, start, end)
})

const buildFallbackTableRows = (
  chart: ChartViewModel,
  start: number,
  end: number,
): Array<Record<string, unknown>> => {
  const out: Array<Record<string, unknown>> = []
  if (chart.variant === 'map') {
    const resolvedValuePath = resolveMapValuePath(chart.config)
    for (let i = start; i < end; i += 1) {
      const row = mapRows.value[i] ?? {}
      const resolvedRow = resolvedValuePath?.rows[i] ?? row
      out.push({
        __rowIndex: i + 1,
        lat: toDisplayValue(chart.config.latPath ? row[chart.config.latPath] : null),
        lon: toDisplayValue(chart.config.lonPath ? row[chart.config.lonPath] : null),
        value: toDisplayValue(
          resolvedValuePath
            ? resolvedRow[resolvedValuePath.resolvedPath]
            : chart.config.valuePath
              ? row[chart.config.valuePath]
              : null,
        ),
        feature: toDisplayValue(chart.config.featurePath ? row[chart.config.featurePath] : null),
        objectFeature: toDisplayValue(
          chart.config.objectFeaturePath ? row[chart.config.objectFeaturePath] : null,
        ),
      })
    }
    return out
  }

  const xSeries = resolveSeries(chart.config.x) ?? resolveSeries(chart.config.y) ?? []
  const ySeries = resolveSeries(chart.config.y) ?? []
  const zSeries = resolveSeries(chart.config.z) ?? []
  for (let i = start; i < end; i += 1) {
    out.push({
      __rowIndex: i + 1,
      x: toDisplayValue(xSeries[i]),
      y: toDisplayValue(ySeries[i]),
      z: toDisplayValue(zSeries[i]),
    })
  }
  return out
}

const csvEscape = (value: unknown): string => {
  const text =
    value == null
      ? ''
      : typeof value === 'string'
        ? value
        : typeof value === 'number'
          ? Number.isFinite(value)
            ? `${value}`
            : ''
          : typeof value === 'boolean'
            ? value
              ? 'true'
              : 'false'
          : (() => {
              try {
                return JSON.stringify(value)
              } catch {
                return '[unserializable]'
              }
            })()
  if (!/[",\n]/.test(text)) return text
  return `"${text.replace(/"/g, '""')}"`
}

const toCsv = (rows: Array<Record<string, unknown>>, columns: string[]): string => {
  const header = columns.map(csvEscape).join(',')
  const body = rows.map((row) => columns.map((key) => csvEscape(row[key])).join(',')).join('\n')
  return `${header}\n${body}`
}

const downloadTableCsv = () => {
  const chart = selectedTableChart.value
  if (!chart || tableRowCount.value === 0) return
  const tableData = selectedTableData.value
  const columns = tableData?.columns ?? tableColumns.value.map((c) => c.field)
  const rows =
    tableData?.rows ??
    buildFallbackTableRows(chart, 0, tableRowCount.value)
  const csv = toCsv(rows, columns)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const base = (chart.title || 'chart_data').replace(/[^\w.-]+/g, '_')
  a.download = `${base}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

async function openTablePopup(index: number) {
  selectedTableChartIndex.value = index
  tablePage.value = 1
  const chart = chartList.value[index]
  if (chart && canRenderChart(chart) && !renderPayloadByKey.value[chart.key]) {
    await updateChart(index)
  }
  tablePopupOpen.value = true
  if (tableRowCount.value === 0 && tableErrorMessage.value) {
    appendChartsLog(`Table popup opened without data: ${tableErrorMessage.value}`, {
      chartIndex: index,
      chartConfig: chart?.config ?? null,
    })
  }
}

onBeforeUnmount(() => {
  sourceScanToken += 1
  mapScanToken += 1
})
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

.object-path-charts__chart,
.object-path-charts__map {
  width: 100%;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
}

.object-path-charts__map-view {
  border: 1px solid rgba(128, 128, 128, 0.2);
  border-radius: 6px;
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

.object-path-charts__thumb-chart :deep(.list-chart),
.object-path-charts__thumb-map {
  pointer-events: none;
}

.object-path-charts__thumb-disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
