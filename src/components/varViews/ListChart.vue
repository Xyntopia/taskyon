<!-- src/components/ListChart.vue -->
<template>
  <div class="column q-gutter-sm">
    <!-- Chart type buttons -->
    <div class="row q-gutter-xs items-center">
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
      </template>

      <template v-else-if="is2D">
        <q-btn dense outline size="sm" color="primary" label="Heatmap" disable />
      </template>

      <span class="text-caption text-grey-7">
        {{ description }}
      </span>
    </div>

    <!-- Chart DOM -->
    <div ref="chartEl" style="width: 100%; min-height: 220px; max-height: 320px"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import * as echarts from 'echarts/core'
import { LineChart, BarChart, HeatmapChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, VisualMapComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([
  LineChart,
  BarChart,
  HeatmapChart,
  GridComponent,
  TooltipComponent,
  VisualMapComponent,
  CanvasRenderer,
])

const props = defineProps<{
  // number[] or number[][]
  value: unknown
}>()

const chartEl = ref<HTMLDivElement | null>(null)
let chart: echarts.ECharts | null = null
let resizeObserver: ResizeObserver | null = null

const chartType = ref<'line' | 'bar' | 'heatmap'>('bar')

const is2D = computed(() => {
  const v = props.value
  return Array.isArray(v) && v.length > 0 && v.every((row) => Array.isArray(row))
})

const is1D = computed(() => {
  const v = props.value
  return Array.isArray(v) && !is2D.value
})

const description = computed(() => {
  if (is2D.value) return '2D numeric array visualized as heatmap'
  if (is1D.value) return '1D numeric array'
  return 'Unsupported data for chart'
})

// Normalize 1D data: number[]
const normalized1D = computed<number[]>(() => {
  if (!is1D.value) return []
  const arr = props.value as unknown[]
  return arr.map((v) => Number(v)).filter((v) => Number.isFinite(v))
})

// Normalize 2D data: number[][]
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

const buildOption = (): echarts.EChartsCoreOption => {
  if (is2D.value) {
    chartType.value = 'heatmap'

    const matrix = normalized2D.value
    const rowCount = matrix.length
    const colCount = Math.max(...matrix.map((r) => r.length), 0)

    const data: [number, number, number][] = []
    matrix.forEach((row, i) => {
      row.forEach((val, j) => {
        if (!Number.isNaN(val)) {
          data.push([j, i, val])
        }
      })
    })

    return {
      tooltip: { position: 'top' },
      grid: { height: '75%', top: '10%' },
      xAxis: {
        type: 'category',
        data: Array.from({ length: colCount }, (_, i) => String(i)),
        splitArea: { show: false },
      },
      yAxis: {
        type: 'category',
        data: Array.from({ length: rowCount }, (_, i) => String(i)),
        splitArea: { show: false },
      },
      visualMap: {
        min: data.length ? Math.min(...data.map((d) => d[2] ?? 0)) : 0,
        max: data.length ? Math.max(...data.map((d) => d[2] ?? 0)) : 0,
        calculable: true,
        orient: 'horizontal',
        left: 'center',
        bottom: 10,
      },
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
      grid: { left: 40, right: 10, top: 20, bottom: 30 },
      xAxis: {
        type: 'category',
        data: x.map((i) => String(i)),
      },
      yAxis: {
        type: 'value',
        scale: true,
      },
      series: {
        type: chartType.value,
        data,
        smooth: chartType.value === 'line',
      },
    }
  }

  // Fallback: empty
  return {
    title: { text: 'No chartable data', left: 'center' },
  }
}

const renderChart = () => {
  if (!chartEl.value) return

  if (!chart) {
    chart = echarts.init(chartEl.value)
  }
  const option = buildOption()
  chart?.setOption(option, true)
}

onMounted(() => {
  if (!chartEl.value) return

  // Initial render (might be 0×0, that's ok; we'll resize when it becomes visible)
  renderChart()

  // Observe container size and resize chart when it changes
  resizeObserver = new ResizeObserver(() => {
    if (chart) {
      chart.resize()
    }
  })
  resizeObserver.observe(chartEl.value)
})

watch(
  () => [props.value, chartType.value],
  () => {
    renderChart()
  },
  { deep: true },
)

onBeforeUnmount(() => {
  if (resizeObserver && chartEl.value) {
    resizeObserver.unobserve(chartEl.value)
    resizeObserver.disconnect()
  }
  if (chart) {
    chart.dispose()
    chart = null
  }
})
</script>
