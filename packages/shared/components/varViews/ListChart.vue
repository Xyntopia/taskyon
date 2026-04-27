<!-- packages/shared/components/varViews/ListChart.vue -->
<template>
  <div class="list-chart column q-gutter-y-sm">
    <div
      v-if="hasChartTitle"
      class="list-chart__title"
      :class="{ 'list-chart__title--compact': isCompactPreview }"
    >
      {{ chartTitle }}
    </div>

    <div v-if="showControls" class="row q-gutter-xs items-center">
      <template v-if="is1D">
        <q-btn
          dense
          outline
          size="sm"
          :color="chartType === 'line' ? 'primary' : 'grey'"
          label="Line"
          @click="chartType = 'line'"
        />
        <q-btn
          dense
          outline
          size="sm"
          :color="chartType === 'bar' ? 'primary' : 'grey'"
          label="Bar"
          @click="chartType = 'bar'"
        />
        <q-btn dense flat :icon="matFullscreen" size="sm" @click="toggleFullscreen" />
      </template>

      <template v-else-if="isXYSeries">
        <q-btn
          dense
          outline
          size="sm"
          :color="chartType === 'line' ? 'primary' : 'grey'"
          label="Line"
          @click="chartType = 'line'"
        />
        <q-btn
          dense
          outline
          size="sm"
          :color="chartType === 'scatter' ? 'primary' : 'grey'"
          label="Scatter"
          @click="chartType = 'scatter'"
        />
        <q-btn dense flat :icon="matFullscreen" size="sm" @click="toggleFullscreen" />
      </template>

      <template v-else-if="isSparseHeatmap">
        <q-btn-toggle
          v-model="sparseRenderMode"
          dense
          unelevated
          toggle-color="primary"
          color="grey-8"
          text-color="grey-4"
          :options="sparseRenderModeOptions"
        />
        <q-select
          v-if="sparseRenderMode !== 'heatmap'"
          v-model="contourMethod"
          dense
          emit-value
          map-options
          :options="contourMethodOptions"
          label="Interpolation"
          class="list-chart__control-select"
        />
        <q-select
          v-if="sparseRenderMode !== 'heatmap'"
          v-model="contourResolution"
          dense
          emit-value
          map-options
          :options="contourResolutionOptions"
          label="Resolution"
          class="list-chart__control-select"
        />
        <q-btn dense flat :icon="matFullscreen" size="sm" @click="toggleFullscreen" />
      </template>

      <template v-else-if="is2D">
        <q-btn dense outline size="sm" color="primary" label="Heatmap" disable />
      </template>

      <span class="text-caption text-grey-7">
        {{ description }}
      </span>
    </div>

    <div ref="chartHost" class="list-chart__host">
      <div
        ref="chartEl"
        :style="{
          width: '100%',
          maxWidth: '100%',
          height: isFullscreen ? '90vh' : chartBodyHeightResolved,
        }"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { matFullscreen } from '@quasar/extras/material-icons'
import {
  buildSparseHeatmapChartData,
  type PlotContourInterpolationMethod,
  type PlotResolution,
  type PlotSparseHeatmapRenderMode,
  type PlotSparseHeatmapValue,
} from '../../modules/plotMath'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts/core'
import { BarChart, HeatmapChart, LineChart, ScatterChart } from 'echarts/charts'
import {
  DataZoomComponent,
  GraphicComponent,
  GridComponent,
  TitleComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([
  LineChart,
  BarChart,
  HeatmapChart,
  ScatterChart,
  GridComponent,
  TooltipComponent,
  VisualMapComponent,
  TitleComponent,
  CanvasRenderer,
  DataZoomComponent,
  GraphicComponent,
])

type XYSeriesValuePayload = {
  kind: 'xy-series'
  xValues: number[]
  yValues: number[]
}

const props = defineProps<{
  value: unknown
  title?: string
  showControls?: boolean
  enableDataZoom?: boolean
  showAxisTicks?: boolean
  showAxisUnits?: boolean
  autoContourOnSparseHeatmap?: boolean
  sparseHeatmapRenderMode?: PlotSparseHeatmapRenderMode
  sparseHeatmapContourMethod?: PlotContourInterpolationMethod
  sparseHeatmapContourResolution?: PlotResolution
  chartHeight?: string | number
  xAxis?: {
    label?: string
    unit?: string
  }
  yAxis?: {
    label?: string
    unit?: string
  }
}>()

const showControls = computed(() => props.showControls !== false)
const enableDataZoom = computed(() => props.enableDataZoom !== false)
const showAxisTicks = computed(() => props.showAxisTicks !== false)
const showAxisUnits = computed(() => props.showAxisUnits !== false)
const chartTitle = computed(() => String(props.title || '').trim())
const hasChartTitle = computed(() => chartTitle.value.length > 0)
const isCompactPreview = computed(
  () => !showControls.value && !enableDataZoom.value && !showAxisTicks.value,
)
const xAxisNameGap = computed(() => (isCompactPreview.value ? 14 : 30))
const yAxisNameGap = computed(() => (isCompactPreview.value ? 20 : 40))
const cartesianGrid = computed(() => ({
  left: isCompactPreview.value ? 34 : 40,
  right: 10,
  top: isCompactPreview.value ? 10 : 20,
  bottom: enableDataZoom.value ? 70 : isCompactPreview.value ? 24 : 56,
}))
const heatmapGrid = computed(() =>
  isCompactPreview.value
    ? {
        left: 34,
        right: 10,
        top: 10,
        bottom: 24,
      }
    : { height: '75%', top: '10%' },
)
const chartHeightResolved = computed(() => {
  const raw = props.chartHeight
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return `${raw}px`
  if (typeof raw === 'string' && raw.trim().length > 0) return raw
  return '260px'
})
const chartBodyHeightResolved = computed(() => {
  if (!hasChartTitle.value) return chartHeightResolved.value
  const titleHeight = isCompactPreview.value ? '34px' : '28px'
  return `calc(${chartHeightResolved.value} - ${titleHeight})`
})

const chartEl = ref<HTMLDivElement | null>(null)
const chartHost = ref<HTMLDivElement | null>(null)
let chart: echarts.ECharts | null = null
let resizeObserver: ResizeObserver | null = null

const chartType = ref<'line' | 'bar' | 'heatmap' | 'scatter'>('bar')

const sparseRenderMode = ref<PlotSparseHeatmapRenderMode>(
  props.sparseHeatmapRenderMode ?? (props.autoContourOnSparseHeatmap ? 'auto' : 'heatmap'),
)
const contourMethod = ref<PlotContourInterpolationMethod>(
  props.sparseHeatmapContourMethod ?? 'optuna-poisson',
)
const contourResolution = ref<PlotResolution>(props.sparseHeatmapContourResolution ?? 'auto')

const sparseRenderModeOptions: Array<{ label: string; value: PlotSparseHeatmapRenderMode }> = [
  { label: 'Heatmap', value: 'heatmap' },
  { label: 'Contour', value: 'contour' },
  { label: 'Auto', value: 'auto' },
]

const contourMethodOptions: Array<{ label: string; value: PlotContourInterpolationMethod }> = [
  { label: 'Optuna (Poisson)', value: 'optuna-poisson' },
  { label: 'Neighbor average', value: 'neighbor-average' },
  { label: 'Nearest expand', value: 'nearest-expand' },
  { label: 'Distance average', value: 'distance-average' },
]

const contourResolutionOptions: Array<{ label: string; value: PlotResolution }> = [
  { label: 'Auto', value: 'auto' },
  { label: '12 x 12', value: 12 },
  { label: '16 x 16', value: 16 },
  { label: '24 x 24', value: 24 },
  { label: '32 x 32', value: 32 },
  { label: '48 x 48', value: 48 },
  { label: '64 x 64', value: 64 },
]

watch(
  () => props.sparseHeatmapRenderMode,
  (next) => {
    if (next) sparseRenderMode.value = next
  },
)
watch(
  () => props.sparseHeatmapContourMethod,
  (next) => {
    if (next) contourMethod.value = next
  },
)
watch(
  () => props.sparseHeatmapContourResolution,
  (next) => {
    if (next != null) contourResolution.value = next
  },
)

const axisLabel = (a?: { label?: string; unit?: string }) =>
  showAxisUnits.value && a?.unit ? `${a.label ?? ''} [${a.unit}]` : a?.label
const formatAxisValue = (n: number): string => {
  if (!Number.isFinite(n)) return String(n)
  if (Number.isInteger(n)) return String(n)
  const s = n.toFixed(5)
  return s.replace(/\.?0+$/, '')
}

const getTupleValueExtent = (
  rows: Array<[number, number, number]>,
): { min: number; max: number } => {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY

  for (const row of rows) {
    const value = Number(row[2])
    if (!Number.isFinite(value)) continue
    if (value < min) min = value
    if (value > max) max = value
  }

  return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : { min: 0, max: 0 }
}

const getMaxRowLength = (matrix: number[][]): number => {
  let maxLen = 0
  for (const row of matrix) {
    if (row.length > maxLen) maxLen = row.length
  }
  return maxLen
}

const is2D = computed(() => {
  const v = props.value
  return Array.isArray(v) && v.length > 0 && v.every((row) => Array.isArray(row))
})

const isSparseHeatmap = computed(() => {
  const v = props.value
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  const payload = v as Partial<PlotSparseHeatmapValue>
  return (
    payload.kind === 'xyv-heatmap' &&
    Array.isArray(payload.xValues) &&
    Array.isArray(payload.yValues) &&
    Array.isArray(payload.points)
  )
})

const isXYSeries = computed(() => {
  const v = props.value
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  const payload = v as Partial<XYSeriesValuePayload>
  return (
    payload.kind === 'xy-series' && Array.isArray(payload.xValues) && Array.isArray(payload.yValues)
  )
})

const is1D = computed(() => {
  const v = props.value
  return Array.isArray(v) && !is2D.value && !isSparseHeatmap.value && !isXYSeries.value
})

const sparseData = computed(() => {
  if (!isSparseHeatmap.value) {
    return {
      xLabels: [] as string[],
      yLabels: [] as string[],
      data: [] as Array<[number, number, number]>,
      fillRatio: 0,
      usedContour: false,
      contourMethod: null as PlotContourInterpolationMethod | null,
    }
  }

  const payload = props.value as PlotSparseHeatmapValue
  const prepared = buildSparseHeatmapChartData(payload, {
    renderMode: sparseRenderMode.value,
    autoContourOnSparseHeatmap: props.autoContourOnSparseHeatmap === true,
    autoContourThreshold: 0.45,
    contourMethod: contourMethod.value,
    contourResolution: contourResolution.value,
  })

  return {
    ...prepared,
    xLabels:
      Array.isArray(payload.xLabels) && payload.xLabels.length === prepared.xValues.length
        ? payload.xLabels
        : prepared.xValues.map((x) => formatAxisValue(x)),
    yLabels:
      Array.isArray(payload.yLabels) && payload.yLabels.length === prepared.yValues.length
        ? payload.yLabels
        : prepared.yValues.map((y) => formatAxisValue(y)),
  }
})

const description = computed(() => {
  if (isSparseHeatmap.value) {
    if (sparseData.value.usedContour) {
      const method = sparseData.value.contourMethod ?? contourMethod.value
      return `Sparse XY points as contour (${method})`
    }
    return 'Sparse XY points visualized as heatmap'
  }
  if (isXYSeries.value) return 'XY numeric series'
  if (is2D.value) return '2D numeric array visualized as heatmap'
  if (is1D.value) return '1D numeric array'
  return 'Unsupported data for chart'
})

const normalizedXYSeries = computed<Array<[number, number]>>(() => {
  if (!isXYSeries.value) return []
  const payload = props.value as XYSeriesValuePayload
  const len = Math.min(payload.xValues.length, payload.yValues.length)
  const points: Array<[number, number]> = []
  for (let i = 0; i < len; i += 1) {
    const x = Number(payload.xValues[i])
    const y = Number(payload.yValues[i])
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    points.push([x, y])
  }
  return points
})

const normalized1D = computed<number[]>(() => {
  if (!is1D.value) return []
  const arr = props.value as unknown[]
  return arr.map((v) => Number(v)).filter((v) => Number.isFinite(v))
})

const normalized2D = computed<number[][]>(() => {
  if (!is2D.value) return []
  const raw = props.value as unknown[]
  return raw.map((row) =>
    (Array.isArray(row) ? row : []).map((val) => {
      const n = Number(val)
      return Number.isFinite(n) ? n : NaN
    }),
  )
})

const xAxisTitleText = computed(() => axisLabel(props.xAxis) ?? '')
const useBottomXAxisTitle = computed(() => enableDataZoom.value && !isCompactPreview.value)
const xAxisNameValue = computed(() => (useBottomXAxisTitle.value ? '' : xAxisTitleText.value))
const bottomXAxisTitleGraphic = computed<echarts.EChartsCoreOption['graphic']>(() => {
  if (!useBottomXAxisTitle.value) return undefined
  const text = String(xAxisTitleText.value || '').trim()
  if (!text) return undefined
  return [
    {
      type: 'text',
      left: 'center',
      bottom: 0,
      silent: true,
      style: {
        text,
        fill: '#666',
        font: '12px sans-serif',
      },
    },
  ]
})

const buildOption = (): echarts.EChartsCoreOption => {
  if (isXYSeries.value) {
    const points = normalizedXYSeries.value
    const seriesType = chartType.value === 'scatter' ? 'scatter' : 'line'

    return {
      tooltip: { trigger: 'axis' },
      grid: cartesianGrid.value,
      graphic: bottomXAxisTitleGraphic.value,
      xAxis: {
        type: 'value',
        scale: true,
        axisLabel: { show: showAxisTicks.value },
        name: xAxisNameValue.value,
        nameLocation: 'middle',
        nameGap: xAxisNameGap.value,
      },
      yAxis: {
        type: 'value',
        scale: true,
        axisLabel: { show: showAxisTicks.value },
        name: axisLabel(props.yAxis),
        nameLocation: 'middle',
        nameGap: yAxisNameGap.value,
      },
      dataZoom: [
        ...(enableDataZoom.value
          ? [
              {
                type: 'inside',
                xAxisIndex: 0,
                filterMode: 'weakFilter',
                throttle: 50,
              },
              {
                type: 'slider',
                xAxisIndex: 0,
                height: 32,
                bottom: 20,
              },
            ]
          : []),
      ],
      series: {
        type: seriesType,
        data: points,
        showSymbol: seriesType === 'scatter',
        symbolSize: seriesType === 'scatter' ? 5 : 3,
        smooth: seriesType === 'line',
        sampling: seriesType === 'line' ? 'lttb' : undefined,
      },
    }
  }

  if (isSparseHeatmap.value) {
    const { xLabels, yLabels, data } = sparseData.value
    const { min: vMin, max: vMax } = getTupleValueExtent(data)

    return {
      tooltip: {
        position: 'top',
        formatter: (params: { value?: unknown }) => {
          const val = Array.isArray(params.value) ? params.value : []
          const xi = Number(val[0])
          const yi = Number(val[1])
          const v = Number(val[2])
          const x = Number.isInteger(xi) && xi >= 0 && xi < xLabels.length ? xLabels[xi] : '?'
          const y = Number.isInteger(yi) && yi >= 0 && yi < yLabels.length ? yLabels[yi] : '?'
          return `x: ${x}<br/>y: ${y}<br/>value: ${v}`
        },
      },
      grid: heatmapGrid.value,
      graphic: bottomXAxisTitleGraphic.value,
      xAxis: {
        type: 'category',
        data: xLabels,
        axisLabel: { show: showAxisTicks.value },
        name: xAxisNameValue.value,
        nameLocation: 'middle',
        nameGap: xAxisNameGap.value,
        splitArea: { show: false },
      },
      yAxis: {
        type: 'category',
        data: yLabels,
        axisLabel: { show: showAxisTicks.value },
        splitArea: { show: false },
        name: axisLabel(props.yAxis),
        nameLocation: 'middle',
        nameGap: yAxisNameGap.value,
      },
      visualMap: {
        min: vMin,
        max: vMax,
        calculable: true,
        orient: 'horizontal',
        left: 'center',
        bottom: 10,
      },
      dataZoom: [
        ...(enableDataZoom.value
          ? [
              {
                type: 'inside',
                xAxisIndex: 0,
                filterMode: 'weakFilter',
                throttle: 50,
              },
              {
                type: 'slider',
                xAxisIndex: 0,
                height: 18,
                bottom: 5,
              },
            ]
          : []),
      ],
      series: [
        {
          type: 'heatmap',
          data,
          label: { show: false },
          emphasis: {
            itemStyle: {
              shadowBlur: 10,
              shadowColor: 'rgba(0, 0, 0, 0.5)',
            },
          },
        },
      ],
    }
  }

  if (is2D.value) {
    chartType.value = 'heatmap'

    const matrix = normalized2D.value
    const rowCount = matrix.length
    const colCount = getMaxRowLength(matrix)

    const data: [number, number, number][] = []
    matrix.forEach((row, i) => {
      row.forEach((val, j) => {
        if (!Number.isNaN(val)) data.push([j, i, val])
      })
    })

    return {
      tooltip: { position: 'top' },
      grid: heatmapGrid.value,
      graphic: bottomXAxisTitleGraphic.value,
      xAxis: {
        type: 'category',
        data: Array.from({ length: colCount }, (_, i) => String(i)),
        axisLabel: { show: showAxisTicks.value },
        name: xAxisNameValue.value,
        nameLocation: 'middle',
        nameGap: xAxisNameGap.value,
        splitArea: { show: false },
      },
      yAxis: {
        type: 'category',
        data: Array.from({ length: rowCount }, (_, i) => String(i)),
        axisLabel: { show: showAxisTicks.value },
        splitArea: { show: false },
        name: axisLabel(props.yAxis),
        nameLocation: 'middle',
        nameGap: yAxisNameGap.value,
      },
      visualMap: {
        ...getTupleValueExtent(data),
        calculable: true,
        orient: 'horizontal',
        left: 'center',
        bottom: 10,
      },
      dataZoom: [
        ...(enableDataZoom.value
          ? [
              {
                type: 'inside',
                xAxisIndex: 0,
                filterMode: 'weakFilter',
                throttle: 50,
              },
              {
                type: 'slider',
                xAxisIndex: 0,
                height: 18,
                bottom: 5,
              },
            ]
          : []),
      ],
      series: [
        {
          type: 'heatmap',
          data,
          label: { show: false },
          emphasis: {
            itemStyle: {
              shadowBlur: 10,
              shadowColor: 'rgba(0, 0, 0, 0.5)',
            },
          },
        },
      ],
    }
  }

  if (is1D.value) {
    const data = normalized1D.value
    const x = data.map((_, i) => i)

    return {
      tooltip: { trigger: 'axis' },
      grid: cartesianGrid.value,
      graphic: bottomXAxisTitleGraphic.value,
      xAxis: {
        type: 'category',
        data: x.map(String),
        axisLabel: { show: showAxisTicks.value },
        name: xAxisNameValue.value,
        nameLocation: 'middle',
        nameGap: xAxisNameGap.value,
      },
      yAxis: {
        type: 'value',
        scale: true,
        axisLabel: { show: showAxisTicks.value },
        name: axisLabel(props.yAxis),
        nameLocation: 'middle',
        nameGap: yAxisNameGap.value,
      },
      dataZoom: [
        ...(enableDataZoom.value
          ? [
              {
                type: 'inside',
                xAxisIndex: 0,
                filterMode: 'weakFilter',
                throttle: 50,
              },
              {
                type: 'slider',
                xAxisIndex: 0,
                height: 32,
                bottom: 20,
              },
            ]
          : []),
      ],
      series: {
        type: chartType.value,
        data,
        smooth: chartType.value === 'line',
        sampling: chartType.value === 'line' ? 'lttp' : undefined,
        large: data.length > 200,
        largeThreshold: 200,
      },
    }
  }

  return {
    title: { text: 'No chartable data', left: 'center' },
  }
}

const renderChart = () => {
  if (!chartEl.value) return
  if (!chart) chart = echarts.init(chartEl.value)
  chart?.setOption(buildOption(), true)
}

onMounted(() => {
  if (!chartEl.value || !chartHost.value) return
  renderChart()

  resizeObserver = new ResizeObserver((entries) => {
    const entry = entries[0]
    const nextWidth = entry ? Math.round(entry.contentRect.width) : chartHost.value?.clientWidth ?? 0
    const nextHeight = entry ? Math.round(entry.contentRect.height) : chartHost.value?.clientHeight ?? 0
    chart?.resize({ width: nextWidth, height: nextHeight })
  })
  resizeObserver.observe(chartHost.value)
  document.addEventListener('fullscreenchange', handleFullscreenChange)
})

watch(
  () => [
    props.value,
    props.title,
    props.showControls,
    props.enableDataZoom,
    props.showAxisTicks,
    props.showAxisUnits,
    props.autoContourOnSparseHeatmap,
    props.sparseHeatmapRenderMode,
    props.sparseHeatmapContourMethod,
    props.sparseHeatmapContourResolution,
    props.chartHeight,
    props.xAxis?.label,
    props.xAxis?.unit,
    props.yAxis?.label,
    props.yAxis?.unit,
    chartType.value,
    sparseRenderMode.value,
    contourMethod.value,
    contourResolution.value,
  ],
  () => {
    renderChart()
  },
  { deep: true },
)

onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', handleFullscreenChange)
  if (resizeObserver && chartHost.value) {
    resizeObserver.unobserve(chartHost.value)
    resizeObserver.disconnect()
  }
  if (chart) {
    chart.dispose()
    chart = null
  }
})

const isFullscreen = ref(false)

const handleFullscreenChange = () => {
  isFullscreen.value = document.fullscreenElement === chartEl.value
  requestAnimationFrame(() => chart?.resize())
}

const toggleFullscreen = async () => {
  if (!chartEl.value) return

  if (document.fullscreenElement === chartEl.value) {
    await document.exitFullscreen()
  } else if (!document.fullscreenElement) {
    await chartEl.value.requestFullscreen()
  }
}
</script>

<style scoped>
.list-chart {
  width: 100%;
  min-width: 0;
  max-width: 100%;
  overflow-x: hidden;
}

.list-chart__title {
  width: 100%;
  text-align: center;
  font-size: 18px;
  font-weight: 700;
  line-height: 1.2;
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.list-chart__title--compact {
  font-size: 11px;
  font-weight: 500;
  line-height: 1.15;
}

.list-chart__control-select {
  min-width: 180px;
}

.list-chart__host {
  width: 100%;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
}
</style>
