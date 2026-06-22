/* eslint-disable @typescript-eslint/no-explicit-any */
import z from 'zod'
import { createNode } from './dagCore'

export type QueryOp = 'identity' | 'sum' | 'mean' | 'min' | 'max' | 'index'

export type QueryAxisSpec = {
  path: string
  op?: QueryOp
  index?: number
}

export type QueryAxisInput =
  | QueryAxisSpec
  | string
  | [string]
  | [string, QueryOp]
  | [string, 'index', number]

export type ObjectiveQuerySpec = {
  direction: 'min' | 'max'
  target: QueryAxisSpec
}

export type PlotQuerySpec = {
  kind: 'plot'
  x: QueryAxisSpec
  y: QueryAxisSpec
}

export type RunManifestRow = {
  runId: string
  rowKey: Record<string, string | number>
  params: Record<string, unknown>
  outputArtifactHash: string
  status?: string
}

export type CompiledPipelineDebug = {
  nodes: Array<{ name: string; kind: string }>
  edges: Array<{ from: string; to: string }>
}

const getPathValue = (source: unknown, path: string): unknown => {
  if (!path) return source
  const parts = path.split('.')
  let cur = source
  for (const part of parts) {
    if (!cur || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

const getDatasetPathValues = (source: unknown, path: string): unknown[] | null => {
  if (!path.startsWith('rows.')) return null
  if (!source || typeof source !== 'object') return null
  const rows = (source as { rows?: unknown }).rows
  if (!Array.isArray(rows)) return null
  const rowPath = path.slice('rows.'.length)
  return rows.map((row) => {
    const value = getPathValue(row, rowPath)
    return value === undefined ? null : value
  })
}

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

const reduceArray = (arr: unknown[], op: Exclude<QueryOp, 'identity' | 'index'>): number | null => {
  const finite = arr
    .map((v) => toFiniteNumber(v))
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  if (finite.length === 0) return null
  if (op === 'sum') return finite.reduce((a, b) => a + b, 0)
  if (op === 'mean') return finite.reduce((a, b) => a + b, 0) / finite.length
  if (op === 'min') return Math.min(...finite)
  return Math.max(...finite)
}

const QUERY_AXIS_KEY_PREFIX = '@q:'

export const normalizeQueryAxisSpec = (input: QueryAxisInput): QueryAxisSpec | null => {
  if (typeof input === 'string') {
    const path = input.trim()
    return path.length > 0 ? { path, op: 'identity' } : null
  }

  if (Array.isArray(input)) {
    const path = typeof input[0] === 'string' ? input[0].trim() : ''
    if (!path) return null
    if (input.length === 1) return { path, op: 'identity' }

    const op = input[1]
    if (op === 'index') {
      const index = typeof input[2] === 'number' && Number.isInteger(input[2]) && input[2] >= 0 ? input[2] : 0
      return { path, op: 'index', index }
    }
    return { path, op: op ?? 'identity' }
  }

  if (!input || typeof input !== 'object') return null
  const path = typeof input.path === 'string' ? input.path.trim() : ''
  if (!path) return null
  const op = input.op ?? 'identity'
  if (op === 'index') {
    const index =
      typeof input.index === 'number' && Number.isInteger(input.index) && input.index >= 0
        ? input.index
        : 0
    return { path, op: 'index', index }
  }
  return { path, op }
}

export const encodeQueryAxisKey = (input: QueryAxisInput): string | null => {
  const spec = normalizeQueryAxisSpec(input)
  if (!spec) return null
  if ((spec.op ?? 'identity') === 'identity') return spec.path
  return `${QUERY_AXIS_KEY_PREFIX}${encodeURIComponent(JSON.stringify(spec))}`
}

export const decodeQueryAxisKey = (value: string): QueryAxisSpec | null => {
  if (typeof value !== 'string' || !value.startsWith(QUERY_AXIS_KEY_PREFIX)) return null
  const payload = value.slice(QUERY_AXIS_KEY_PREFIX.length)
  if (!payload) return null
  try {
    const decoded = JSON.parse(decodeURIComponent(payload)) as QueryAxisInput
    return normalizeQueryAxisSpec(decoded)
  } catch {
    return null
  }
}

export const evaluateQueryAxisValue = (raw: unknown, input: QueryAxisInput): number | null => {
  const spec = normalizeQueryAxisSpec(input)
  if (!spec) return null
  const op = spec.op ?? 'identity'
  if (op === 'identity') return toFiniteNumber(raw)
  if (!Array.isArray(raw)) return null
  if (op === 'index') return toFiniteNumber(raw[spec.index ?? 0])
  return reduceArray(raw, op)
}

const asRowSourceSchema = z.object({
  params: z.record(z.string(), z.unknown()),
  outputs: z.record(z.string(), z.unknown()),
})

const asDatasetSourceSchema = z.object({
  rows: z.array(asRowSourceSchema),
})

const withUnique = (prefix: string): string => `${prefix}_${Math.random().toString(36).slice(2, 10)}`

export const createPathSelectNode = (args: {
  name: string
  sourceNode: any
  path: string
}) => {
  const sourceParamsSchema = (args.sourceNode as { paramsSchema?: z.ZodTypeAny }).paramsSchema
  return createNode({
    name: args.name,
    version: 1,
    hiddenInputs: {
      source: args.sourceNode,
    },
    localParams: (sourceParamsSchema as z.ZodObject<z.ZodRawShape>) ?? z.object({}),
    outputSchema: z.unknown(),
    run: async (params, use) => {
      const sourceOut = await use.source(params)
      const datasetValues = getDatasetPathValues(sourceOut, args.path)
      if (datasetValues) return datasetValues
      const value = getPathValue(sourceOut, args.path)
      return value === undefined ? null : value
    },
  })
}

export const createArrayReduceNode = (args: {
  name: string
  sourceNode: any
  op: Exclude<QueryOp, 'identity' | 'index'>
  mode: 'all' | 'perItem'
}) => {
  const sourceParamsSchema = (args.sourceNode as { paramsSchema?: z.ZodTypeAny }).paramsSchema
  return createNode({
    name: args.name,
    version: 1,
    hiddenInputs: {
      source: args.sourceNode,
    },
    localParams: (sourceParamsSchema as z.ZodObject<z.ZodRawShape>) ?? z.object({}),
    outputSchema: z.unknown(),
    run: async (params, use) => {
      const input = await use.source(params)
      if (!Array.isArray(input)) return null
      if (args.mode === 'all') return reduceArray(input, args.op)
      return input.map((item) => {
        if (!Array.isArray(item)) return null
        return reduceArray(item, args.op)
      })
    },
  })
}

export const createArrayIndexNode = (args: {
  name: string
  sourceNode: any
  index: number
  mode: 'all' | 'perItem'
}) => {
  const sourceParamsSchema = (args.sourceNode as { paramsSchema?: z.ZodTypeAny }).paramsSchema
  return createNode({
    name: args.name,
    version: 1,
    hiddenInputs: {
      source: args.sourceNode,
    },
    localParams: (sourceParamsSchema as z.ZodObject<z.ZodRawShape>) ?? z.object({}),
    outputSchema: z.unknown(),
    run: async (params, use) => {
      const input = await use.source(params)
      if (!Array.isArray(input)) return null
      if (args.mode === 'all') {
        return input[args.index] ?? null
      }
      return input.map((item) => {
        if (!Array.isArray(item)) return null
        return item[args.index] ?? null
      })
    },
  })
}

export const createTransposeForPlotNode = (args: {
  name: string
  xNode: any
  yNode: any
}) => {
  const sourceParamsSchema =
    (args.xNode as { paramsSchema?: z.ZodTypeAny }).paramsSchema ?? z.object({})
  return createNode({
    name: args.name,
    version: 1,
    hiddenInputs: {
      x: args.xNode,
      y: args.yNode,
    },
    localParams: sourceParamsSchema as z.ZodObject<z.ZodRawShape>,
    outputSchema: z.object({
      kind: z.literal('xy-series'),
      xValues: z.array(z.number()),
      yValues: z.array(z.number()),
    }),
    run: async (params, use) => {
      const rawX = await use.x(params)
      const rawY = await use.y(params)
      if (!Array.isArray(rawX) || !Array.isArray(rawY)) {
        return { kind: 'xy-series' as const, xValues: [], yValues: [] }
      }
      const len = Math.min(rawX.length, rawY.length)
      const xValues: number[] = []
      const yValues: number[] = []
      for (let i = 0; i < len; i += 1) {
        const x = toFiniteNumber(rawX[i])
        const y = toFiniteNumber(rawY[i])
        if (x == null || y == null) continue
        xValues.push(x)
        yValues.push(y)
      }
      return { kind: 'xy-series' as const, xValues, yValues }
    },
  })
}

const compileAxisForRow = (args: {
  sourceNode: any
  axis: QueryAxisSpec
  prefix: string
  debug: CompiledPipelineDebug
}) => {
  const pathNode = createPathSelectNode({
    name: withUnique(`${args.prefix}_path_select`),
    sourceNode: args.sourceNode,
    path: args.axis.path,
  })
  args.debug.nodes.push({ name: pathNode.name, kind: 'PathSelectNode' })
  args.debug.edges.push({ from: args.sourceNode.name, to: pathNode.name })

  const op = args.axis.op ?? 'identity'
  if (op === 'identity') return pathNode

  if (op === 'index') {
    const idx = Number.isInteger(args.axis.index) ? (args.axis.index as number) : 0
    const indexNode = createArrayIndexNode({
      name: withUnique(`${args.prefix}_array_index`),
      sourceNode: pathNode,
      index: idx,
      mode: 'all',
    })
    args.debug.nodes.push({ name: indexNode.name, kind: 'ArrayIndexNode' })
    args.debug.edges.push({ from: pathNode.name, to: indexNode.name })
    return indexNode
  }

  const reduceNode = createArrayReduceNode({
    name: withUnique(`${args.prefix}_array_reduce`),
    sourceNode: pathNode,
    op,
    mode: 'all',
  })
  args.debug.nodes.push({ name: reduceNode.name, kind: 'ArrayReduceNode' })
  args.debug.edges.push({ from: pathNode.name, to: reduceNode.name })
  return reduceNode
}

const compileAxisForDataset = (args: {
  sourceNode: any
  axis: QueryAxisSpec
  prefix: string
  debug: CompiledPipelineDebug
}) => {
  const pathNode = createPathSelectNode({
    name: withUnique(`${args.prefix}_path_select`),
    sourceNode: args.sourceNode,
    path: args.axis.path,
  })
  args.debug.nodes.push({ name: pathNode.name, kind: 'PathSelectNode' })
  args.debug.edges.push({ from: args.sourceNode.name, to: pathNode.name })

  const op = args.axis.op ?? 'identity'
  if (op === 'identity') return pathNode

  if (op === 'index') {
    const idx = Number.isInteger(args.axis.index) ? (args.axis.index as number) : 0
    const indexNode = createArrayIndexNode({
      name: withUnique(`${args.prefix}_array_index`),
      sourceNode: pathNode,
      index: idx,
      mode: 'perItem',
    })
    args.debug.nodes.push({ name: indexNode.name, kind: 'ArrayIndexNode' })
    args.debug.edges.push({ from: pathNode.name, to: indexNode.name })
    return indexNode
  }

  const reduceNode = createArrayReduceNode({
    name: withUnique(`${args.prefix}_array_reduce`),
    sourceNode: pathNode,
    op,
    mode: 'perItem',
  })
  args.debug.nodes.push({ name: reduceNode.name, kind: 'ArrayReduceNode' })
  args.debug.edges.push({ from: pathNode.name, to: reduceNode.name })
  return reduceNode
}

export const compileObjectiveQuery = (args: {
  sourceNode: any
  objective: ObjectiveQuerySpec
  namePrefix?: string
}): {
  objectiveNode: any
  debug: CompiledPipelineDebug
} => {
  const debug: CompiledPipelineDebug = {
    nodes: [{ name: args.sourceNode.name, kind: 'SourceNode' }],
    edges: [],
  }
  const prefix = args.namePrefix ?? 'objective'

  const axisNode = compileAxisForRow({
    sourceNode: args.sourceNode,
    axis: args.objective.target,
    prefix,
    debug,
  })

  const objectiveNode = createNode({
    name: withUnique(`${prefix}_terminal_scalar`),
    version: 1,
    hiddenInputs: { source: axisNode },
    localParams:
      ((args.sourceNode as { paramsSchema?: z.ZodTypeAny }).paramsSchema as z.ZodObject<
        z.ZodRawShape
      >) ?? z.object({}),
    outputSchema: z.object({ value: z.number().nullable() }),
    run: async (params, use) => {
      const raw = await use.source(params)
      const scalar = toFiniteNumber(raw)
      return { value: scalar }
    },
  })
  debug.nodes.push({ name: objectiveNode.name, kind: 'ObjectiveTerminalNode' })
  debug.edges.push({ from: axisNode.name, to: objectiveNode.name })

  return { objectiveNode, debug }
}

export const compilePlotQuery = (args: {
  sourceNode: any
  query: PlotQuerySpec
  namePrefix?: string
}): {
  plotNode: any
  debug: CompiledPipelineDebug
} => {
  const debug: CompiledPipelineDebug = {
    nodes: [{ name: args.sourceNode.name, kind: 'SourceNode' }],
    edges: [],
  }
  const prefix = args.namePrefix ?? 'plot'

  const xNode = compileAxisForDataset({
    sourceNode: args.sourceNode,
    axis: args.query.x,
    prefix: `${prefix}_x`,
    debug,
  })
  const yNode = compileAxisForDataset({
    sourceNode: args.sourceNode,
    axis: args.query.y,
    prefix: `${prefix}_y`,
    debug,
  })

  const plotNode = createTransposeForPlotNode({
    name: withUnique(`${prefix}_transpose_xy`),
    xNode,
    yNode,
  })
  debug.nodes.push({ name: plotNode.name, kind: 'TransposeForPlotNode' })
  debug.edges.push({ from: xNode.name, to: plotNode.name })
  debug.edges.push({ from: yNode.name, to: plotNode.name })

  return { plotNode, debug }
}

export const RowSourceSchema = asRowSourceSchema
export const DatasetSourceSchema = asDatasetSourceSchema

export const createRowSourceNode = (args: { name?: string }) =>
  createNode({
    name: args.name ?? withUnique('row_source'),
    version: 1,
    localParams: asRowSourceSchema,
    outputSchema: asRowSourceSchema,
    run: (params) => params,
  })

export const createDatasetSourceNode = (args: { name?: string }) =>
  createNode({
    name: args.name ?? withUnique('dataset_source'),
    version: 1,
    localParams: asDatasetSourceSchema,
    outputSchema: asDatasetSourceSchema,
    run: (params) => params,
  })
