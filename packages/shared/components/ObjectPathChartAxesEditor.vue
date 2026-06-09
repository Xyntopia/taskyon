<template>
  <div class="object-path-charts__row row q-col-gutter-sm items-center">
    <div class="object-path-charts__col col-12 col-md-2">
      <q-select
        v-model="plotMode"
        :options="plotModeOptions"
        emit-value
        map-options
        outlined
        dense
        options-dense
        label="Chart type"
      />
    </div>
    <div class="object-path-charts__col col-12 col-md-4">
      <q-select
        v-model="xPath"
        :options="xPathOptionsResolved"
        emit-value
        map-options
        outlined
        dense
        options-dense
        use-input
        hide-selected
        fill-input
        input-debounce="0"
        label="X path"
        option-label="label"
        option-value="value"
        @filter="handleFilter"
      />
    </div>
    <div class="object-path-charts__col col-12 col-md-2">
      <q-select
        v-model="xAxisTransformKind"
        :options="axisTransformKindOptions"
        emit-value
        map-options
        outlined
        dense
        options-dense
        label="X transform"
      />
    </div>
    <div v-if="xAxisTransformKind === 'aggregate'" class="object-path-charts__col col-12 col-md-2">
      <q-select
        v-model="xAxisAggregateOp"
        :options="aggregateOpOptions"
        emit-value
        map-options
        outlined
        dense
        options-dense
        label="X aggregate"
      />
    </div>
    <div v-if="xAxisTransformKind === 'index'" class="object-path-charts__col col-12 col-md-2">
      <q-input v-model.number="xAxisIndex" type="number" min="0" outlined dense label="X index" />
    </div>

    <div class="object-path-charts__col col-12 col-md-4">
      <q-select
        v-model="yPath"
        :options="yPathOptionsResolved"
        emit-value
        map-options
        outlined
        dense
        options-dense
        use-input
        hide-selected
        fill-input
        input-debounce="0"
        clearable
        label="Y path"
        option-label="label"
        option-value="value"
        @filter="handleFilter"
      />
    </div>
    <div class="object-path-charts__col col-12 col-md-2">
      <q-select
        v-model="yAxisTransformKind"
        :options="axisTransformKindOptions"
        emit-value
        map-options
        outlined
        dense
        options-dense
        label="Y transform"
      />
    </div>
    <div v-if="yAxisTransformKind === 'aggregate'" class="object-path-charts__col col-12 col-md-2">
      <q-select
        v-model="yAxisAggregateOp"
        :options="aggregateOpOptions"
        emit-value
        map-options
        outlined
        dense
        options-dense
        label="Y aggregate"
      />
    </div>
    <div v-if="yAxisTransformKind === 'index'" class="object-path-charts__col col-12 col-md-2">
      <q-input v-model.number="yAxisIndex" type="number" min="0" outlined dense label="Y index" />
    </div>

    <div v-if="plotMode === 'heatmap'" class="object-path-charts__col col-12 col-md-4">
      <q-select
        v-model="zPath"
        :options="zPathOptionsResolved"
        emit-value
        map-options
        outlined
        dense
        options-dense
        use-input
        hide-selected
        fill-input
        input-debounce="0"
        clearable
        label="Z path (optional)"
        option-label="label"
        option-value="value"
        @filter="handleFilter"
      />
    </div>
    <div v-if="plotMode === 'heatmap'" class="object-path-charts__col col-12 col-md-2">
      <q-select
        v-model="zAxisTransformKind"
        :options="axisTransformKindOptions"
        emit-value
        map-options
        outlined
        dense
        options-dense
        label="Z transform"
      />
    </div>
    <div
      v-if="plotMode === 'heatmap' && zAxisTransformKind === 'aggregate'"
      class="object-path-charts__col col-12 col-md-2"
    >
      <q-select
        v-model="zAxisAggregateOp"
        :options="aggregateOpOptions"
        emit-value
        map-options
        outlined
        dense
        options-dense
        label="Z aggregate"
      />
    </div>
    <div
      v-if="plotMode === 'heatmap' && zAxisTransformKind === 'index'"
      class="object-path-charts__col col-12 col-md-2"
    >
      <q-input v-model.number="zAxisIndex" type="number" min="0" outlined dense label="Z index" />
    </div>
    <div class="object-path-charts__col col-12" :class="showRemove ? 'col-md-2' : 'col-md-3'">
      <q-input v-model="chartTitle" outlined dense label="Title (optional)" />
    </div>
    <div v-if="showRemove" class="object-path-charts__col col-12 col-md-1">
      <q-btn flat dense color="negative" label="Remove" @click="emit('remove')" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { PlotResolution } from '../modules/plotMath'

type Option = { label: string; value: string }
type AxisTransformKind = 'scalar' | 'aggregate' | 'index'
type AxisTransform =
  | { kind: 'scalar' }
  | { kind: 'aggregate'; op: 'mean' | 'sum' | 'min' | 'max' }
  | { kind: 'index'; index: number }

export type ObjectPathChartDefinition = {
  kind?: 'plot' | 'map' | undefined
  plotMode?: '2d' | 'heatmap' | undefined
  x?: string | undefined
  y?: string | undefined
  z?: string | undefined
  xAxisTransform?: AxisTransform | undefined
  yAxisTransform?: AxisTransform | undefined
  zAxisTransform?: AxisTransform | undefined
  latPath?: string | undefined
  lonPath?: string | undefined
  valuePath?: string | undefined
  valueAxisTransform?: AxisTransform | undefined
  featurePath?: string | undefined
  showContour?: boolean | undefined
  showFeatures?: boolean | undefined
  resolution?: PlotResolution | undefined
  title?: string | undefined
  objectFeaturePath?: string | undefined
  seriesMetaPath?: string | undefined
  showZoomToMarkedButton?: boolean | undefined
  zoomToMarkedLayerIds?: string[] | undefined
  bindingProjectId?: string | undefined
  bindingProblemId?: string | undefined
  bindingMode?: 'live' | undefined
  lastResolvedRunSetId?: string | undefined
}

const props = withDefaults(
  defineProps<{
    pathOptions: Option[]
    scalarPathOptions?: Option[] | undefined
    arrayPathOptions?: Option[] | undefined
    showRemove?: boolean | undefined
  }>(),
  {
    scalarPathOptions: undefined,
    arrayPathOptions: undefined,
    showRemove: false,
  },
)

const configModel = defineModel<ObjectPathChartDefinition>('config', {
  default: () => ({}),
})

const plotModeOptions: Array<{ label: string; value: '2d' | 'heatmap' }> = [
  { label: '2D', value: '2d' },
  { label: 'Heatmap', value: 'heatmap' },
]

const axisTransformKindOptions: Array<{ label: string; value: AxisTransformKind }> = [
  { label: 'Scalar', value: 'scalar' },
  { label: 'Aggregate', value: 'aggregate' },
  { label: 'Index', value: 'index' },
]

const aggregateOpOptions: Array<{ label: string; value: 'mean' | 'sum' | 'min' | 'max' }> = [
  { label: 'Mean', value: 'mean' },
  { label: 'Sum', value: 'sum' },
  { label: 'Min', value: 'min' },
  { label: 'Max', value: 'max' },
]

const scalarPathOptionsResolved = computed(() =>
  Array.isArray(props.scalarPathOptions) && props.scalarPathOptions.length > 0
    ? props.scalarPathOptions
    : props.pathOptions,
)

const arrayPathOptionsResolved = computed(() =>
  Array.isArray(props.arrayPathOptions) ? props.arrayPathOptions : [],
)

const plotMode = computed<'2d' | 'heatmap'>({
  get: () => configModel.value.plotMode ?? (configModel.value.z ? 'heatmap' : '2d'),
  set: (value) => {
    configModel.value = {
      ...configModel.value,
      plotMode: value,
      ...(value === '2d' ? { z: undefined } : {}),
    }
  },
})

const withAxisTransform = (axis: 'x' | 'y' | 'z', transform: AxisTransform) => {
  const key = axis === 'x' ? 'xAxisTransform' : axis === 'y' ? 'yAxisTransform' : 'zAxisTransform'
  configModel.value = {
    ...configModel.value,
    [key]: transform,
  }
}

const axisTransformOf = (axis: 'x' | 'y' | 'z'): AxisTransform => {
  const transform =
    axis === 'x'
      ? configModel.value.xAxisTransform
      : axis === 'y'
        ? configModel.value.yAxisTransform
        : configModel.value.zAxisTransform
  if (!transform || typeof transform !== 'object') return { kind: 'scalar' }
  const kind = transform.kind
  if (kind === 'aggregate') {
    return {
      kind: 'aggregate',
      op:
        transform.op === 'sum' || transform.op === 'min' || transform.op === 'max'
          ? transform.op
          : 'mean',
    }
  }
  if (kind === 'index') {
    return {
      kind: 'index',
      index:
        typeof transform.index === 'number' &&
        Number.isInteger(transform.index) &&
        transform.index >= 0
          ? transform.index
          : 0,
    }
  }
  return { kind: 'scalar' }
}

const axisTransformKind = (axis: 'x' | 'y' | 'z') =>
  computed<AxisTransformKind>({
    get: () => axisTransformOf(axis).kind,
    set: (kind) => {
      const prev = axisTransformOf(axis)
      if (kind === 'aggregate') {
        withAxisTransform(axis, {
          kind: 'aggregate',
          op: prev.kind === 'aggregate' ? prev.op : 'mean',
        })
        return
      }
      if (kind === 'index') {
        withAxisTransform(axis, {
          kind: 'index',
          index: prev.kind === 'index' ? prev.index : 0,
        })
        return
      }
      withAxisTransform(axis, { kind: 'scalar' })
    },
  })

const axisAggregateOp = (axis: 'x' | 'y' | 'z') =>
  computed<'mean' | 'sum' | 'min' | 'max'>({
    get: () => {
      const transform = axisTransformOf(axis)
      return transform.kind === 'aggregate' ? transform.op : 'mean'
    },
    set: (value) => {
      withAxisTransform(axis, { kind: 'aggregate', op: value })
    },
  })

const axisIndex = (axis: 'x' | 'y' | 'z') =>
  computed<number>({
    get: () => {
      const transform = axisTransformOf(axis)
      return transform.kind === 'index' ? transform.index : 0
    },
    set: (value) => {
      const idx = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
      withAxisTransform(axis, { kind: 'index', index: idx })
    },
  })

const xAxisTransformKind = axisTransformKind('x')
const yAxisTransformKind = axisTransformKind('y')
const zAxisTransformKind = axisTransformKind('z')
const xAxisAggregateOp = axisAggregateOp('x')
const yAxisAggregateOp = axisAggregateOp('y')
const zAxisAggregateOp = axisAggregateOp('z')
const xAxisIndex = axisIndex('x')
const yAxisIndex = axisIndex('y')
const zAxisIndex = axisIndex('z')

const xPathOptionsResolved = computed(() =>
  xAxisTransformKind.value === 'scalar'
    ? scalarPathOptionsResolved.value
    : arrayPathOptionsResolved.value,
)
const yPathOptionsResolved = computed(() =>
  yAxisTransformKind.value === 'scalar'
    ? scalarPathOptionsResolved.value
    : arrayPathOptionsResolved.value,
)
const zPathOptionsResolved = computed(() =>
  zAxisTransformKind.value === 'scalar'
    ? scalarPathOptionsResolved.value
    : arrayPathOptionsResolved.value,
)

const xPath = computed({
  get: () => configModel.value.x ?? '',
  set: (value: string) => {
    configModel.value = { ...configModel.value, x: value || undefined }
  },
})

const yPath = computed({
  get: () => configModel.value.y ?? '',
  set: (value: string | null) => {
    configModel.value = { ...configModel.value, y: value || undefined }
  },
})

const zPath = computed({
  get: () => configModel.value.z ?? '',
  set: (value: string | null) => {
    configModel.value = { ...configModel.value, z: value || undefined }
  },
})

const chartTitle = computed({
  get: () => configModel.value.title ?? '',
  set: (value: string | number | null) => {
    const text = String(value ?? '').trim()
    configModel.value = { ...configModel.value, title: text || undefined }
  },
})

const emit = defineEmits<{
  (e: 'filter', value: string, update: (fn: () => void) => void): void
  (e: 'remove'): void
}>()

function handleFilter(value: string, update: (fn: () => void) => void) {
  emit('filter', value, update)
}

void props
</script>
