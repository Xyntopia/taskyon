import { runToPlotFlatRow } from '@taskyon/common/modules/plotMath'
import { createNode, explode } from '@taskyon/comp-dag/dagCore'
import { decodeQueryAxisKey, evaluateQueryAxisValue } from '@taskyon/comp-dag/queryPipeline'
import {
  flattenRuns as flattenRunsPure,
  profileColumns as profileColumnsPure,
  type ColumnStats,
  type FlattenInput,
  type FlattenOutput,
} from '@taskyon/comp-dag/runtime'

export { explode }
export type { ColumnStats, FlattenRunInput } from '@taskyon/comp-dag/runtime'

export type ColumnProfileInput = {
  rows: Array<Record<string, unknown>>
}

export type ColumnProfileOutput = {
  rowCount: number
  columnCount: number
  columns: Record<string, ColumnStats>
}

export type FlattenAndProfileOutput = {
  flatten: FlattenOutput
  profile: ColumnProfileOutput
}

export type OptimizationResultsQueryInput =
  | {
      kind: 'scanKeys'
      rows: Array<Record<string, unknown>>
    }
  | {
      kind: 'columnProfile'
      rows: Array<Record<string, unknown>>
    }
  | {
      kind: 'columnProfileRuns'
      runs: FlattenInput['runs']
    }

export type OptimizationResultsQueryOutput =
  | {
      kind: 'scanKeys'
      keys: string[]
      rowCount: number
    }
  | {
      kind: 'columnProfile'
      profile: ColumnProfileOutput
    }

export const flattenRuns = (input: FlattenInput): FlattenOutput => flattenRunsPure(input)

export const profileColumns = (input: ColumnProfileInput): ColumnProfileOutput => {
  return profileColumnsPure(input.rows)
}

export const flattenAndProfileRuns = (input: FlattenInput): FlattenAndProfileOutput => {
  const flatten = flattenRuns(input)
  const profile = profileColumns({ rows: flatten.rows })
  return { flatten, profile }
}

export const queryOptimizationRows = (
  input: OptimizationResultsQueryInput,
): OptimizationResultsQueryOutput => {
  if (input.kind === 'scanKeys') {
    const keySet = new Set<string>()
    for (const row of input.rows) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) continue
      for (const key of Object.keys(row)) keySet.add(key)
    }
    return {
      kind: 'scanKeys',
      keys: Array.from(keySet).sort((a, b) => a.localeCompare(b)),
      rowCount: input.rows.length,
    }
  }

  if (input.kind === 'columnProfileRuns') {
    const flatten = flattenRuns({ runs: input.runs })
    return {
      kind: 'columnProfile',
      profile: profileColumns({ rows: flatten.rows }),
    }
  }

  return {
    kind: 'columnProfile',
    profile: profileColumns({ rows: input.rows }),
  }
}

export type OptimizationResultsLoadRowsRunRef = {
  params?: unknown
  outputs?: unknown
  captured?: unknown
}

export type OptimizationResultsLoadRowsInput = {
  runRefs: OptimizationResultsLoadRowsRunRef[]
  maxRows: number
}

export type OptimizationResultsLoadRowsOutput = {
  rows: Array<Record<string, unknown>>
  loadedRows: number
  totalRows: number
  estimatedBytes: number
}

const estimateBytes = (value: unknown): number => {
  try {
    return JSON.stringify(value).length
  } catch {
    return 0
  }
}

export const loadOptimizationRows = (
  input: OptimizationResultsLoadRowsInput,
): OptimizationResultsLoadRowsOutput => {
  const maxRows = Math.max(0, Math.min(input.maxRows, input.runRefs.length))
  const rows: Array<Record<string, unknown>> = []
  for (let i = 0; i < maxRows; i += 1) {
    const ref = input.runRefs[i]
    if (!ref) continue
    // Keep a row even for lazy refs so local/non-worker callers do not drop the dataset entirely.
    // When run refs are path-backed, worker execution hydrates outputs from storage.
    rows.push(runToPlotFlatRow(ref as Record<string, unknown>, i))
  }
  return {
    rows,
    loadedRows: rows.length,
    totalRows: maxRows,
    estimatedBytes: estimateBytes(rows),
  }
}

const unknownRecordJsonSchema = { type: 'object', additionalProperties: true } as const
const flattenRunInputJsonSchema = {
  type: 'object',
  properties: {
    params: {},
    outputs: {},
    captured: {},
  },
  additionalProperties: false,
} as const
const rowsJsonSchema = { type: 'array', items: unknownRecordJsonSchema } as const
const columnStatsJsonSchema = {
  type: 'object',
  properties: {
    rowsSeen: { type: 'number' },
    presentCount: { type: 'number' },
    nullCount: { type: 'number' },
    undefinedCount: { type: 'number' },
    nonNullCount: { type: 'number' },
    informativeCount: { type: 'number' },
    constantLikeCount: { type: 'number' },
    distinctValueCount: { type: 'number' },
    allPresentValuesConstant: { type: 'boolean' },
    typeCounts: { type: 'object', additionalProperties: { type: 'number' } },
    alwaysNullish: { type: 'boolean' },
    nullishRate: { type: 'number' },
    presenceRate: { type: 'number' },
  },
  required: [
    'rowsSeen',
    'presentCount',
    'nullCount',
    'undefinedCount',
    'nonNullCount',
    'informativeCount',
    'constantLikeCount',
    'distinctValueCount',
    'allPresentValuesConstant',
    'typeCounts',
    'alwaysNullish',
    'nullishRate',
    'presenceRate',
  ],
  additionalProperties: false,
} as const
const columnProfileOutputJsonSchema = {
  type: 'object',
  properties: {
    rowCount: { type: 'number' },
    columnCount: { type: 'number' },
    columns: { type: 'object', additionalProperties: columnStatsJsonSchema },
  },
  required: ['rowCount', 'columnCount', 'columns'],
  additionalProperties: false,
} as const

const flattenInputJsonSchema = {
  type: 'object',
  properties: {
    runs: { type: 'array', items: flattenRunInputJsonSchema },
    options: {
      type: 'object',
      properties: { includePrefixes: { type: 'boolean' } },
      additionalProperties: false,
    },
  },
  required: ['runs'],
  additionalProperties: false,
} as const
const flattenOutputJsonSchema = {
  type: 'object',
  properties: {
    rows: rowsJsonSchema,
    rowCount: { type: 'number' },
    keyCount: { type: 'number' },
  },
  required: ['rows', 'rowCount', 'keyCount'],
  additionalProperties: false,
} as const

export const FlattenNode = createNode<
  typeof flattenInputJsonSchema,
  typeof flattenOutputJsonSchema,
  Record<never, never>,
  Record<never, never>,
  FlattenInput,
  FlattenOutput
>({
  name: 'FlattenNode',
  version: 1,
  localParams: flattenInputJsonSchema,
  outputSchema: flattenOutputJsonSchema,
  run: (params) => flattenRuns(params),
})

const columnProfileInputJsonSchema = {
  type: 'object',
  properties: { rows: rowsJsonSchema },
  required: ['rows'],
  additionalProperties: false,
} as const

export const ColumnProfileNode = createNode<
  typeof columnProfileInputJsonSchema,
  typeof columnProfileOutputJsonSchema,
  Record<never, never>,
  Record<never, never>,
  ColumnProfileInput,
  ColumnProfileOutput
>({
  name: 'ColumnProfileNode',
  version: 1,
  localParams: columnProfileInputJsonSchema,
  outputSchema: columnProfileOutputJsonSchema,
  run: (params) => profileColumns(params),
})

const optimizationResultsQueryInputJsonSchema = {
  type: 'object',
  properties: {
    kind: { enum: ['scanKeys', 'columnProfile', 'columnProfileRuns'] },
    rows: rowsJsonSchema,
    runs: { type: 'array', items: flattenRunInputJsonSchema },
  },
  required: ['kind'],
  additionalProperties: false,
} as const
const optimizationResultsQueryOutputJsonSchema = {
  type: 'object',
  properties: {
    kind: { enum: ['scanKeys', 'columnProfile'] },
    keys: { type: 'array', items: { type: 'string' } },
    rowCount: { type: 'number' },
    profile: columnProfileOutputJsonSchema,
  },
  required: ['kind'],
  allOf: [
    {
      if: { properties: { kind: { const: 'scanKeys' } } },
      then: { required: ['keys', 'rowCount'] },
    },
    {
      if: { properties: { kind: { const: 'columnProfile' } } },
      then: { required: ['profile'] },
    },
  ],
  additionalProperties: false,
} as const

export const OptimizationResultsQueryNode = createNode<
  typeof optimizationResultsQueryInputJsonSchema,
  typeof optimizationResultsQueryOutputJsonSchema,
  Record<never, never>,
  Record<never, never>,
  OptimizationResultsQueryInput,
  OptimizationResultsQueryOutput
>({
  name: 'OptimizationResultsQueryNode',
  version: 1,
  localParams: optimizationResultsQueryInputJsonSchema,
  outputSchema: optimizationResultsQueryOutputJsonSchema,
  run: (params) => {
    if (params.kind === 'columnProfileRuns') {
      return queryOptimizationRows({
        kind: 'columnProfileRuns',
        runs: params.runs ?? [],
      })
    }
    if (params.kind === 'scanKeys') {
      return queryOptimizationRows({
        kind: 'scanKeys',
        rows: params.rows ?? [],
      })
    }
    return queryOptimizationRows({
      kind: 'columnProfile',
      rows: params.rows ?? [],
    })
  },
})

const optimizationResultsRunRefJsonSchema = {
  type: 'object',
  properties: {
    params: {},
    outputs: {},
    captured: {},
  },
  additionalProperties: false,
} as const
const optimizationResultsLoadRowsInputJsonSchema = {
  type: 'object',
  properties: {
    runRefs: { type: 'array', items: optimizationResultsRunRefJsonSchema },
    maxRows: { type: 'number' },
  },
  required: ['runRefs', 'maxRows'],
  additionalProperties: false,
} as const
const optimizationResultsLoadRowsOutputJsonSchema = {
  type: 'object',
  properties: {
    rows: rowsJsonSchema,
    loadedRows: { type: 'number' },
    totalRows: { type: 'number' },
    estimatedBytes: { type: 'number' },
  },
  required: ['rows', 'loadedRows', 'totalRows', 'estimatedBytes'],
  additionalProperties: false,
} as const

export const OptimizationResultsLoadRowsNode = createNode<
  typeof optimizationResultsLoadRowsInputJsonSchema,
  typeof optimizationResultsLoadRowsOutputJsonSchema,
  Record<never, never>,
  Record<never, never>,
  OptimizationResultsLoadRowsInput,
  OptimizationResultsLoadRowsOutput
>({
  name: 'OptimizationResultsLoadRowsNode',
  version: 1,
  localParams: optimizationResultsLoadRowsInputJsonSchema,
  outputSchema: optimizationResultsLoadRowsOutputJsonSchema,
  run: (params) => loadOptimizationRows(params),
})

export type ChartResolveAxisOp = 'identity' | 'sum' | 'mean' | 'min' | 'max' | 'index'
export type ChartAxisTransform =
  | { kind: 'scalar' }
  | { kind: 'aggregate'; op: 'mean' | 'sum' | 'min' | 'max' }
  | { kind: 'index'; index: number }

export type LiveChartResolveInput = {
  runRefs: OptimizationResultsLoadRowsRunRef[]
  maxRows: number
  datasetIdentity: string
  chart: {
    plotMode?: '2d' | 'heatmap' | undefined
    x?: string | undefined
    y?: string | undefined
    z?: string | undefined
    xAxisTransform?: ChartAxisTransform | undefined
    yAxisTransform?: ChartAxisTransform | undefined
    zAxisTransform?: ChartAxisTransform | undefined
  }
}

export type LiveChartResolveOutput = {
  datasetIdentity: string
  plotValue?: unknown
  tableColumns: string[]
  tableRows: Array<Record<string, unknown>>
  error?: string | undefined
}

export type LiveChartResolveRowsInput = {
  rows: Array<Record<string, unknown>>
  datasetIdentity: string
  chart: LiveChartResolveInput['chart']
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

const resolveSeriesFromRows = (
  rows: Array<Record<string, unknown>>,
  key?: string,
): number[] | null => {
  if (!key) return null
  const axisSpec = decodeQueryAxisKey(key)
  const series: number[] = []
  let hasFinite = false
  for (const row of rows) {
    const raw = axisSpec ? row[axisSpec.path] : row[key]
    const n = axisSpec ? evaluateQueryAxisValue(raw, axisSpec) : toFiniteNumber(raw)
    const val = typeof n === 'number' && Number.isFinite(n) ? n : Number.NaN
    if (Number.isFinite(val)) hasFinite = true
    series.push(val)
  }
  return hasFinite ? series : null
}

const axisTransformOf = (
  chart: LiveChartResolveInput['chart'],
  axis: 'x' | 'y' | 'z',
): ChartAxisTransform => {
  const transform =
    axis === 'x' ? chart.xAxisTransform : axis === 'y' ? chart.yAxisTransform : chart.zAxisTransform
  if (!transform || typeof transform !== 'object') return { kind: 'scalar' }
  if (transform.kind === 'aggregate') {
    return { kind: 'aggregate', op: transform.op ?? 'mean' }
  }
  if (transform.kind === 'index') {
    return {
      kind: 'index',
      index: Number.isInteger(transform.index) && transform.index >= 0 ? transform.index : 0,
    }
  }
  return { kind: 'scalar' }
}

const resolveAxisSeries = (
  rows: Array<Record<string, unknown>>,
  key: string | undefined,
  transform: ChartAxisTransform,
): number[] | null => {
  if (!key) return null
  if (transform.kind === 'scalar') return resolveSeriesFromRows(rows, key)
  const arrays = resolveArrayPathRows(rows, key)
  if (!arrays) return null
  if (transform.kind === 'aggregate') {
    const series = arrays
      .map((row) => aggregateArray(row, transform.op))
      .map((v) => (v == null ? Number.NaN : v))
    return series.some((v) => Number.isFinite(v)) ? series : null
  }
  const series = arrays
    .map((row) => indexArray(row, transform.index))
    .map((v) => (v == null ? Number.NaN : v))
  return series.some((v) => Number.isFinite(v)) ? series : null
}

const resolveArrayPathRows = (
  rows: Array<Record<string, unknown>>,
  path?: string,
): Array<number[] | null> | null => {
  if (!path) return null
  const out: Array<number[] | null> = []
  let hasAny = false
  for (const row of rows) {
    const raw = row[path]
    if (!Array.isArray(raw)) {
      out.push(null)
      continue
    }
    const values: number[] = []
    let hasFinite = false
    for (const entry of raw) {
      const n = toFiniteNumber(entry)
      if (n == null) {
        values.push(Number.NaN)
        continue
      }
      hasFinite = true
      values.push(n)
    }
    if (!hasFinite) {
      out.push(null)
      continue
    }
    hasAny = true
    out.push(values)
  }
  return hasAny ? out : null
}

const aggregateArray = (
  row: number[] | null,
  op: 'mean' | 'sum' | 'min' | 'max',
): number | null => {
  if (!row || row.length === 0) return null
  let count = 0
  let sum = 0
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const v of row) {
    if (!Number.isFinite(v)) continue
    count += 1
    sum += v
    if (v < min) min = v
    if (v > max) max = v
  }
  if (count === 0) return null
  if (op === 'sum') return sum
  if (op === 'min') return min
  if (op === 'max') return max
  return sum / count
}

const indexArray = (row: number[] | null, index: number): number | null => {
  if (!row || row.length === 0) return null
  const value = row[index]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

type ResolvedChartSeries = {
  plotMode: '2d' | 'heatmap'
  x: number[] | null
  y: number[] | null
  z: number[] | null
}

const resolveChartSeries = (
  rows: Array<Record<string, unknown>>,
  chart: LiveChartResolveInput['chart'],
): ResolvedChartSeries => {
  const plotMode = chart.plotMode ?? (chart.z ? 'heatmap' : '2d')
  return {
    plotMode,
    x: resolveAxisSeries(rows, chart.x, axisTransformOf(chart, 'x')),
    y: resolveAxisSeries(rows, chart.y, axisTransformOf(chart, 'y')),
    z: resolveAxisSeries(rows, chart.z, axisTransformOf(chart, 'z')),
  }
}

const buildPlotValue = (series: ResolvedChartSeries): unknown => {
  if (series.plotMode === 'heatmap' && series.x && series.y && series.z) {
    const x = series.x
    const y = series.y
    const z = series.z
    const len = Math.min(x.length, y.length, z.length)
    const points: Array<{ x: number; y: number; v: number }> = []
    for (let i = 0; i < len; i += 1) points.push({ x: x[i]!, y: y[i]!, v: z[i]! })
    return {
      kind: 'xyv-heatmap' as const,
      xValues: Array.from(new Set(points.map((p) => p.x))),
      yValues: Array.from(new Set(points.map((p) => p.y))),
      points,
    }
  }

  if (series.x && series.y) {
    const x = series.x
    const y = series.y
    const len = Math.min(x.length, y.length)
    return { kind: 'xy-series' as const, xValues: x.slice(0, len), yValues: y.slice(0, len) }
  }
  if (series.x) return series.x
  if (series.y) return series.y
  return undefined
}

const buildPlotTableData = (
  series: ResolvedChartSeries,
): { columns: string[]; rows: Array<Record<string, unknown>> } => {
  const xSeries = series.x ?? []
  const ySeries = series.y ?? []
  const zSeries = series.z ?? []

  const outRows: Array<Record<string, unknown>> = []
  const rowCount = Math.max(xSeries.length, ySeries.length, zSeries.length)

  if (series.plotMode === 'heatmap') {
    for (let i = 0; i < rowCount; i += 1) {
      outRows.push({
        __rowIndex: i + 1,
        x: toDisplayValue(xSeries[i]),
        y: toDisplayValue(ySeries[i]),
        z: toDisplayValue(zSeries[i]),
      })
    }
    return { columns: ['__rowIndex', 'x', 'y', 'z'], rows: outRows }
  }

  for (let i = 0; i < rowCount; i += 1) {
    outRows.push({
      __rowIndex: i + 1,
      x: toDisplayValue(xSeries[i]),
      y: toDisplayValue(ySeries[i]),
      z: toDisplayValue(zSeries[i]),
    })
  }
  return { columns: ['__rowIndex', 'x', 'y', 'z'], rows: outRows }
}

const axisErrorMessage = (
  axis: 'x' | 'y' | 'z',
  path: string | undefined,
  transform: ChartAxisTransform,
): string => {
  if (!path) return `Missing ${axis.toUpperCase()} path.`
  if (transform.kind === 'aggregate') {
    return `No numeric array data found for ${axis.toUpperCase()} path "${path}" with aggregate "${transform.op}".`
  }
  if (transform.kind === 'index') {
    return `No numeric array data found for ${axis.toUpperCase()} path "${path}" at index ${transform.index}.`
  }
  return `No numeric scalar data found for ${axis.toUpperCase()} path "${path}".`
}

const buildChartError = (
  rows: Array<Record<string, unknown>>,
  chart: LiveChartResolveInput['chart'],
  series: ResolvedChartSeries,
): string | undefined => {
  if (rows.length === 0) return 'No optimization rows are available for this chart.'

  if (series.plotMode === 'heatmap') {
    if (!chart.x || !chart.y || !chart.z) {
      return 'Heatmap requires X, Y, and Z paths.'
    }
    if (!series.x) return axisErrorMessage('x', chart.x, axisTransformOf(chart, 'x'))
    if (!series.y) return axisErrorMessage('y', chart.y, axisTransformOf(chart, 'y'))
    if (!series.z) return axisErrorMessage('z', chart.z, axisTransformOf(chart, 'z'))
    return undefined
  }

  if (!chart.x && !chart.y) return '2D chart requires at least one axis path (X or Y).'
  if (chart.x && !series.x) return axisErrorMessage('x', chart.x, axisTransformOf(chart, 'x'))
  if (chart.y && !series.y) return axisErrorMessage('y', chart.y, axisTransformOf(chart, 'y'))
  return undefined
}

export const resolveLiveChartQueryFromRows = (
  input: LiveChartResolveRowsInput,
): LiveChartResolveOutput => {
  const rows = input.rows
  const series = resolveChartSeries(rows, input.chart)
  const plotValue = buildPlotValue(series)
  const table = buildPlotTableData(series)
  const error = buildChartError(rows, input.chart, series)
  return {
    datasetIdentity: input.datasetIdentity,
    ...(plotValue !== undefined ? { plotValue } : {}),
    tableColumns: table.columns,
    tableRows: table.rows,
    ...(error ? { error } : {}),
  }
}

export const resolveLiveChartQuery = (input: LiveChartResolveInput): LiveChartResolveOutput => {
  const loaded = loadOptimizationRows({ runRefs: input.runRefs, maxRows: input.maxRows })
  return resolveLiveChartQueryFromRows({
    rows: loaded.rows,
    datasetIdentity: input.datasetIdentity,
    chart: input.chart,
  })
}

const chartAxisTransformJsonSchema = {
  oneOf: [
    {
      type: 'object',
      properties: { kind: { const: 'scalar' } },
      required: ['kind'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        kind: { const: 'aggregate' },
        op: { enum: ['mean', 'sum', 'min', 'max'] },
      },
      required: ['kind', 'op'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        kind: { const: 'index' },
        index: { type: 'number' },
      },
      required: ['kind', 'index'],
      additionalProperties: false,
    },
  ],
} as const
const liveChartResolveInputJsonSchema = {
  type: 'object',
  properties: {
    runRefs: { type: 'array', items: optimizationResultsRunRefJsonSchema },
    maxRows: { type: 'number' },
    datasetIdentity: { type: 'string' },
    chart: {
      type: 'object',
      properties: {
        plotMode: { enum: ['2d', 'heatmap'] },
        x: { type: 'string' },
        y: { type: 'string' },
        z: { type: 'string' },
        xAxisTransform: chartAxisTransformJsonSchema,
        yAxisTransform: chartAxisTransformJsonSchema,
        zAxisTransform: chartAxisTransformJsonSchema,
      },
      additionalProperties: false,
    },
  },
  required: ['runRefs', 'maxRows', 'datasetIdentity', 'chart'],
  additionalProperties: false,
} as const
const liveChartResolveOutputJsonSchema = {
  type: 'object',
  properties: {
    datasetIdentity: { type: 'string' },
    plotValue: {},
    tableColumns: { type: 'array', items: { type: 'string' } },
    tableRows: rowsJsonSchema,
    error: { type: 'string' },
  },
  required: ['datasetIdentity', 'tableColumns', 'tableRows'],
  additionalProperties: false,
} as const

export const LiveChartQueryResolveNode = createNode<
  typeof liveChartResolveInputJsonSchema,
  typeof liveChartResolveOutputJsonSchema,
  Record<never, never>,
  Record<never, never>,
  LiveChartResolveInput,
  LiveChartResolveOutput
>({
  name: 'LiveChartQueryResolveNode',
  version: 1,
  localParams: liveChartResolveInputJsonSchema,
  outputSchema: liveChartResolveOutputJsonSchema,
  run: (params) => resolveLiveChartQuery(params),
})
