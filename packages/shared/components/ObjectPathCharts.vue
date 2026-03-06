<template>
  <div class="object-path-charts column q-gutter-md">
    <div class="row items-center q-gutter-sm">
      <q-btn dense flat color="primary" label="Add Chart" @click="addChart" />
      <span class="text-caption text-grey-7">
        Select numeric-array paths from the source object.
      </span>
    </div>

    <q-card v-if="!sourceObject || pathOptions.length === 0" flat bordered class="object-path-charts__card">
      <q-card-section class="text-caption text-grey-7">
        No plottable numeric series found yet.
      </q-card-section>
    </q-card>

    <q-card
      v-for="(chart, index) in chartList"
      :key="chart.key"
      flat
      bordered
      class="object-path-charts__card"
    >
      <q-card-section class="q-gutter-sm">
        <div class="object-path-charts__row row q-col-gutter-sm items-center">
          <div class="object-path-charts__col col-12 col-md-3">
            <q-select
              v-model="chart.config.x"
              :options="filteredPathOptions"
              emit-value
              map-options
              outlined
              dense
              use-input
              fill-input
              input-debounce="0"
              label="X path"
              @filter="filterPathOptions"
            />
          </div>
          <div class="object-path-charts__col col-12 col-md-3">
            <q-select
              v-model="chart.config.y"
              :options="filteredPathOptions"
              emit-value
              map-options
              outlined
              dense
              use-input
              fill-input
              input-debounce="0"
              clearable
              label="Y path"
              @filter="filterPathOptions"
            />
          </div>
          <div class="object-path-charts__col col-12 col-md-3">
            <q-select
              v-model="chart.config.z"
              :options="filteredPathOptions"
              emit-value
              map-options
              outlined
              dense
              use-input
              fill-input
              input-debounce="0"
              clearable
              label="Z path (optional)"
              @filter="filterPathOptions"
            />
          </div>
          <div class="object-path-charts__col col-12 col-md-2">
            <q-input v-model="chart.config.title" outlined dense label="Title (optional)" />
          </div>
          <div class="object-path-charts__col col-12 col-md-1">
            <q-btn
              flat
              dense
              color="negative"
              label="Remove"
              @click="removeChart(index)"
            />
          </div>
        </div>

        <div v-if="chart.value !== undefined" class="object-path-charts__chart">
          <ListChart
            :value="chart.value"
            :title="chart.title"
            :x-axis="{ label: toAxisLabel(chart.config.x) }"
            :y-axis="{ label: toAxisLabel(chart.config.z || chart.config.y) }"
          />
        </div>
        <div v-else class="text-caption text-grey-7">
          Pick valid axis paths to render this chart.
        </div>
      </q-card-section>
    </q-card>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import ListChart from './ListChart.vue'

export type ObjectPathChartDefinition = {
  x?: string | undefined
  y?: string | undefined
  z?: string | undefined
  title?: string | undefined
}

const props = defineProps<{
  source?: Record<string, unknown> | null
}>()

const chartsModel = defineModel<ObjectPathChartDefinition[]>({ default: () => [] })

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

function addChart() {
  chartsModel.value = [...chartsModel.value, buildDefaultChart()]
}

function removeChart(index: number) {
  chartsModel.value = chartsModel.value.filter((_, i) => i !== index)
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
</style>
