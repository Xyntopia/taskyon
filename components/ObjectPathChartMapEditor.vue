<template>
  <div class="object-path-charts__row row q-col-gutter-sm items-center">
    <div class="object-path-charts__col col-12 col-md-2">
      <q-toggle v-model="showContour" dense label="Contour" />
    </div>
    <div class="object-path-charts__col col-12 col-md-2">
      <q-toggle v-model="showFeatures" dense label="Features" />
    </div>
    <div class="object-path-charts__col col-12 col-md-3">
      <q-btn
        flat
        dense
        color="primary"
        :label="showCoordinateInputs ? 'Hide coordinates' : 'Show coordinates'"
        @click="showCoordinateInputs = !showCoordinateInputs"
      />
      <div class="text-caption text-grey-7 q-mt-xs">
        Lat: {{ effectiveLatPath || 'auto' }} | Lon: {{ effectiveLonPath || 'auto' }}
      </div>
    </div>
    <div class="object-path-charts__col col-12 col-md-3">
      <q-select
        v-model="valuePathBase"
        :options="valuePathOptions"
        label="Value path"
        dense
        clearable
        emit-value
        map-options
      />
    </div>
    <div class="object-path-charts__col col-12 col-md-2">
      <q-select
        v-model="valueTransformKind"
        :options="valueTransformKindOptions"
        label="Value transform"
        dense
        emit-value
        map-options
      />
    </div>
    <div v-if="valueTransformKind === 'aggregate'" class="object-path-charts__col col-12 col-md-2">
      <q-select
        v-model="valueAggregateOp"
        :options="aggregateOpOptions"
        label="Value aggregate"
        dense
        emit-value
        map-options
      />
    </div>
    <div v-if="valueTransformKind === 'index'" class="object-path-charts__col col-12 col-md-2">
      <q-input v-model.number="valueIndex" type="number" min="0" dense label="Value index" />
    </div>
    <div class="object-path-charts__col col-12 col-md-2">
      <q-select
        v-model="featurePath"
        :options="featurePathOptions"
        label="Feature path"
        dense
        clearable
        emit-value
        map-options
      />
    </div>
    <div class="object-path-charts__col col-12 col-md-2">
      <q-select
        v-model="objectFeaturePath"
        :options="objectFeaturePathOptions"
        label="Object metadata path"
        dense
        clearable
        emit-value
        map-options
      />
    </div>
    <div class="object-path-charts__col col-12" :class="showRemove ? 'col-md-2' : 'col-md-3'">
      <q-select
        v-model="resolution"
        :options="plotResolutionOptions"
        label="Resolution"
        dense
        emit-value
        map-options
      />
    </div>
    <div class="object-path-charts__col col-12" :class="showRemove ? 'col-md-8' : 'col-md-9'">
      <q-input v-model="chartTitle" outlined dense label="Title (optional)" />
    </div>
    <div class="object-path-charts__col col-12 col-md-3">
      <q-toggle v-model="showZoomToMarkedButton" dense label="Show zoom button" />
    </div>
    <div class="object-path-charts__col col-12" :class="showRemove ? 'col-md-5' : 'col-md-6'">
      <q-input
        v-model="zoomToMarkedLayerIdsCsv"
        outlined
        dense
        label="Zoom layer ids (comma-separated, optional)"
      />
    </div>
    <div v-if="showRemove" class="object-path-charts__col col-12 col-md-1">
      <q-btn flat dense color="negative" label="Remove" @click="emit('remove')" />
    </div>
    <div v-if="showCoordinateInputs" class="object-path-charts__col col-12 col-md-3">
      <q-select
        v-model="latPath"
        :options="columnOptions"
        label="Lat path"
        dense
        clearable
        emit-value
        map-options
      />
    </div>
    <div v-if="showCoordinateInputs" class="object-path-charts__col col-12 col-md-3">
      <q-select
        v-model="lonPath"
        :options="columnOptions"
        label="Lon path"
        dense
        clearable
        emit-value
        map-options
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { PlotResolution } from '../modules/plotMath'
import type { ObjectPathChartDefinition } from './ObjectPathChartAxesEditor.vue'
import { decodeQueryAxisKey } from '../../compDag/queryPipeline'

type Option = { label: string; value: string }
type AxisTransformKind = 'scalar' | 'aggregate' | 'index'
type MapValueTransform =
  | { kind: 'scalar' }
  | { kind: 'aggregate'; op: 'mean' | 'sum' | 'min' | 'max' }
  | { kind: 'index'; index: number }

const props = withDefaults(
  defineProps<{
    columnOptions: Option[]
    numericColumnOptions: Option[]
    arrayNumericColumnOptions: Option[]
    featurePathOptions: Option[]
    objectFeaturePathOptions: Option[]
    detectedLatPath?: string | null
    detectedLonPath?: string | null
    showRemove?: boolean
    plotResolutionOptions: Array<{ label: string; value: PlotResolution }>
  }>(),
  {
    showRemove: false,
  },
)

const configModel = defineModel<ObjectPathChartDefinition>('config', {
  default: () => ({}),
})
const showCoordinateInputs = ref(false)

const valueTransformKindOptions: Array<{ label: string; value: AxisTransformKind }> = [
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

const decodedValueAxis = computed(() => {
  const encoded = configModel.value.valuePath
  if (!encoded || typeof encoded !== 'string') return null
  return decodeQueryAxisKey(encoded)
})

const mapValueTransform = computed<MapValueTransform>(() => {
  const explicit = configModel.value.valueAxisTransform
  if (explicit?.kind === 'aggregate') {
    const op =
      explicit.op === 'sum' || explicit.op === 'min' || explicit.op === 'max' ? explicit.op : 'mean'
    return { kind: 'aggregate', op }
  }
  if (explicit?.kind === 'index') {
    const index =
      typeof explicit.index === 'number' && Number.isInteger(explicit.index) && explicit.index >= 0
        ? explicit.index
        : 0
    return { kind: 'index', index }
  }
  if (explicit?.kind === 'scalar') return { kind: 'scalar' }

  const axis = decodedValueAxis.value
  if (!axis) return { kind: 'scalar' }
  if (axis.op === 'index') {
    const index =
      typeof axis.index === 'number' && Number.isInteger(axis.index) && axis.index >= 0 ? axis.index : 0
    return { kind: 'index', index }
  }
  if (axis.op === 'sum' || axis.op === 'mean' || axis.op === 'min' || axis.op === 'max') {
    return { kind: 'aggregate', op: axis.op }
  }
  return { kind: 'scalar' }
})

const valueTransformKind = computed<AxisTransformKind>({
  get: () => {
    const transform = mapValueTransform.value
    return transform.kind
  },
  set: (kind) => {
    const currentPath = valuePath.value || undefined
    const nextTransform: MapValueTransform =
      kind === 'aggregate'
        ? { kind: 'aggregate', op: 'mean' }
        : kind === 'index'
          ? { kind: 'index', index: 0 }
          : { kind: 'scalar' }
    if (kind === 'scalar') {
      configModel.value = {
        ...configModel.value,
        kind: 'map',
        valuePath: currentPath,
        valueAxisTransform: { kind: 'scalar' },
      }
    } else {
      configModel.value = {
        ...configModel.value,
        kind: 'map',
        valuePath: currentPath,
        valueAxisTransform: nextTransform,
      }
    }
  },
})

const valuePathOptions = computed<Option[]>(() =>
  valueTransformKind.value === 'scalar' ? props.numericColumnOptions : props.arrayNumericColumnOptions,
)

const effectiveLatPath = computed(() => configModel.value.latPath ?? props.detectedLatPath ?? '')
const effectiveLonPath = computed(() => configModel.value.lonPath ?? props.detectedLonPath ?? '')

const latPath = computed({
  get: () => configModel.value.latPath ?? '',
  set: (value: string | null) => {
    configModel.value = { ...configModel.value, kind: 'map', latPath: value || undefined }
  },
})

const lonPath = computed({
  get: () => configModel.value.lonPath ?? '',
  set: (value: string | null) => {
    configModel.value = { ...configModel.value, kind: 'map', lonPath: value || undefined }
  },
})

const valuePath = computed({
  get: () => {
    const axis = decodedValueAxis.value
    if (axis?.path) return axis.path
    return configModel.value.valuePath ?? ''
  },
  set: (value: string | null) => {
    const nextPath = value || undefined
    if (!nextPath) {
      configModel.value = {
        ...configModel.value,
        kind: 'map',
        valuePath: undefined,
        valueAxisTransform: mapValueTransform.value,
      }
      return
    }
    configModel.value = {
      ...configModel.value,
      kind: 'map',
      valuePath: nextPath,
      valueAxisTransform: mapValueTransform.value,
    }
  },
})
const valuePathBase = valuePath

const valueAggregateOp = computed<'mean' | 'sum' | 'min' | 'max'>({
  get: () => {
    const transform = mapValueTransform.value
    if (transform.kind !== 'aggregate') return 'mean'
    if (transform.op === 'sum' || transform.op === 'min' || transform.op === 'max') return transform.op
    return 'mean'
  },
  set: (op) => {
    configModel.value = {
      ...configModel.value,
      kind: 'map',
      valuePath: valuePath.value || undefined,
      valueAxisTransform: { kind: 'aggregate', op },
    }
  },
})

const valueIndex = computed<number>({
  get: () => {
    const transform = mapValueTransform.value
    if (transform.kind !== 'index') return 0
    return transform.index
  },
  set: (index) => {
    const normalized = Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0
    configModel.value = {
      ...configModel.value,
      kind: 'map',
      valuePath: valuePath.value || undefined,
      valueAxisTransform: { kind: 'index', index: normalized },
    }
  },
})

const featurePath = computed({
  get: () => configModel.value.featurePath ?? '',
  set: (value: string | null) => {
    configModel.value = { ...configModel.value, kind: 'map', featurePath: value || undefined }
  },
})

const objectFeaturePath = computed({
  get: () => configModel.value.objectFeaturePath ?? '',
  set: (value: string | null) => {
    configModel.value = { ...configModel.value, kind: 'map', objectFeaturePath: value || undefined }
  },
})

const resolution = computed<PlotResolution>({
  get: () => configModel.value.resolution ?? 'auto',
  set: (value: PlotResolution) => {
    configModel.value = { ...configModel.value, kind: 'map', resolution: value }
  },
})

const showContour = computed({
  get: () => configModel.value.showContour !== false,
  set: (value: boolean) => {
    configModel.value = { ...configModel.value, kind: 'map', showContour: value }
  },
})

const showFeatures = computed({
  get: () => configModel.value.showFeatures !== false,
  set: (value: boolean) => {
    configModel.value = { ...configModel.value, kind: 'map', showFeatures: value }
  },
})

const chartTitle = computed({
  get: () => configModel.value.title ?? '',
  set: (value: string | number | null) => {
    const text = String(value ?? '').trim()
    configModel.value = { ...configModel.value, kind: 'map', title: text || undefined }
  },
})

const showZoomToMarkedButton = computed({
  get: () => configModel.value.showZoomToMarkedButton !== false,
  set: (value: boolean) => {
    configModel.value = { ...configModel.value, kind: 'map', showZoomToMarkedButton: value }
  },
})

const toCsv = (ids: string[] | undefined): string => (Array.isArray(ids) ? ids.join(', ') : '')

const parseCsv = (value: string): string[] | undefined => {
  const ids = value
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0)
  return ids.length > 0 ? Array.from(new Set(ids)) : undefined
}

const zoomToMarkedLayerIdsCsv = computed({
  get: () => toCsv(configModel.value.zoomToMarkedLayerIds),
  set: (value: string | number | null) => {
    const nextIds = parseCsv(String(value ?? ''))
    configModel.value = {
      ...configModel.value,
      kind: 'map',
      ...(nextIds ? { zoomToMarkedLayerIds: nextIds } : { zoomToMarkedLayerIds: undefined }),
    }
  },
})

const emit = defineEmits<{
  (e: 'remove'): void
}>()

void props
</script>
