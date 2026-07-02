// dagCore.ts
// DAG core for a lazy, demand-driven, typed computational graph.
//
// Purpose:
// - Represent model computations as a directed acyclic graph (DAG) with typed params/outputs.
// - Evaluate only the artifacts required by the requested output node and params.
// - Expose internal graph variables (including exploded inputs) so study() can run efficient
//   search/optimization strategies over intermediate structure instead of treating the graph as
//   an opaque black box.
//
// This supports exploration/optimization workflows that need max/min search with fine-grained
// control over evaluation order and caching.

import type { DagStorageBackend } from './caching.ts'
import { canonicalHash, getDefaultInMemoryBackend, type Hash } from './caching.ts'
import {
  combineObjectSchemas,
  emptyObjectSchema,
  objectSchema,
  oneOfSchema,
  parseSchema,
  safeParseSchema,
  schemaArrayElement,
  schemaAtPath,
  schemaDescription,
  type DagJsonSchema,
  type DagSchemaType,
} from './dagSchema.ts'

// -----------------------------
// Core types
// -----------------------------

export interface NodeContext {
  nowUtcMs: number
  log: (msg: string, data?: unknown) => void
}

type CacheRule = 'NoCache' | 'ReadOnly' | 'WriteOnly' | 'ReadWrite'
type ArtifactScope = 'Environment' | 'ModelState' | 'Debug'

interface NodePolicy {
  cache: CacheRule
  scope: ArtifactScope
}

export interface EngineConfig {
  nodePolicies?: Record<string, NodePolicy>
  storageBackend?: DagStorageBackend
  execution?: DagExecutionConfig
  parameterBindings?: Record<string, Record<string, unknown>>
}

export type DagExecutionMode = 'worker' | 'local'

export interface DagExecutionRunner {
  runNode?: <P = unknown, O = unknown>(args: {
    node: DagNode<P, O>
    params: P
    ctx: NodeContext
    engineConfig: EngineConfig
  }) => Promise<{ value: O; artifactHash?: Hash } | null>
  runStudy?: <P = unknown, O = unknown>(args: {
    node: DagNode<P, O>
    params: P
    opts?: StudyOptions
    ctx: NodeContext
    engineConfig: EngineConfig
  }) => Promise<StudyResult<O> | null>
}

export interface DagExecutionConfig {
  mode?: DagExecutionMode
  allowLocalFallback?: boolean
  runner?: DagExecutionRunner
  yieldEveryRows?: number
}

export type SortSpec = {
  path: string
  direction?: 'asc' | 'desc'
}

export type StudyObjective = {
  path: string
  direction: 'min' | 'max'
}

export type StudyHistoryEntry<O = unknown> = {
  rowIndex: number
  row: O
  rowKey: Record<string, string | number>
  sourceIndexByAlias: Record<string, number>
  objectiveValue: number | null
  captured?: Record<string, unknown>
}

export type StudyInputStrategyContext<O = unknown> = {
  alias: string
  candidates: unknown[]
  remainingIndices: number[]
  evaluatedIndices: number[]
  history: StudyHistoryEntry<O>[]
  objective?: StudyObjective
  getCandidateValue: (index: number, path: string) => unknown
  random: () => number
}

export type StudyInputStrategy<O = unknown> = (
  ctx: StudyInputStrategyContext<O>,
) => number[] | Promise<number[]>

export type StudyInputOption = {
  provider?: string | number
  sortBy?: SortSpec[]
  mode?: 'cross' | 'zip'
  zipGroup?: string
  strategy?: StudyInputStrategy
}

export type StudyVariableSpec =
  | { kind: 'constant'; value?: unknown; role?: 'control' | 'risk' | 'fixed'; group?: string }
  | {
      kind: 'list' | 'grid'
      values: unknown[]
      role?: 'control' | 'risk' | 'fixed'
      group?: string
    }
  | {
      kind: 'weightedList'
      values: Array<{ value: unknown; weight?: number }>
      role?: 'control' | 'risk' | 'fixed'
      group?: string
    }
  | {
      kind: 'sweep'
      method?: 'linear' | 'log'
      start: number
      end: number
      step: number
      role?: 'control' | 'risk' | 'fixed'
      group?: string
    }

export type StudyBudget = {
  maxRows?: number
  maxEvals?: number
  timeMs?: number
}

export type StudyCaptureSpec = {
  path: string
  as?: string | undefined
}

export type StudyOptions = {
  mode?: 'explore' | 'optimize'
  objective?: StudyObjective
  variables?: Record<string, StudyVariableSpec>
  inputs?: Record<string, StudyInputOption>
  budget?: StudyBudget
  capture?: StudyCaptureSpec[]
  dryRun?: boolean
  plan?: StudyPlan
  rngSeed?: number
  onRow?: (event: StudyRowEvent) => void | Promise<void>
}

export type StudyAliasPlan = {
  alias: string
  provider?: string | number
  sourceNodeName: string
  sourcePath: string
  length: number
  mode: 'cross' | 'zip'
  zipGroup?: string
}

export type StudyPlan = {
  explodedInputs: StudyAliasPlan[]
  variableRuns: number
  estimatedRows: number
}

export type StudyRowEvent<O = unknown> = {
  rowIndex: number
  row: O
  rowKey: Record<string, string | number>
  sourceIndexByAlias: Record<string, number>
  objectiveValue: number | null
  captured?: Record<string, unknown>
}

export type StudyResult<O> = {
  rows: O[]
  rowKeys: Record<string, string | number>[]
  plan: StudyPlan
  bestIndex: number | null
  best: O | null
  completedEvals: number
  stoppedReason: 'maxRows' | 'maxEvals' | 'timeMs' | null
}

// High-level node (no hashes visible here)
export interface DagNode<
  P = unknown,
  O = unknown,
  PSchema extends DagJsonSchema = DagJsonSchema,
  OSchema extends DagJsonSchema = DagJsonSchema,
> {
  name: string
  localName?: string | undefined
  contentHash?: Hash | undefined
  version: number

  paramsSchema: PSchema
  outputSchema: OSchema

  defaultPolicy: NodePolicy

  // normalized inputs (both exposed & internal)
  hiddenInputs?: Record<string, DagNode> | undefined
  exposedInputs?: Record<string, ExposedInputDef> | undefined

  // internal implementation, used only by the engine
  _runImpl: (params: unknown, helpers: unknown, ctx?: NodeContext) => unknown

  call(params: P): {
    // pass the node itself in order to make recursive execution possible...
    node: DagNode<P, O, PSchema, OSchema>
    params: P

    // run always returns a promise, even if the underlying node is sync. This is due to most storage backends
    // for caching being async and we want to keep the interface consistent.
    run: (
      ctx?: NodeContext,
      engineConfig?: EngineConfig,
    ) => Promise<{ value: O; artifactHash: Hash }>
    study: (
      opts?: StudyOptions,
      ctx?: NodeContext,
      engineConfig?: EngineConfig,
    ) => Promise<StudyResult<O>>
  }
}

function getNodeCodeHash(node: DagNode): Hash {
  if (node.contentHash) return node.contentHash

  // Legacy fallback for code-defined nodes that do not yet provide content identity.
  return canonicalHash(`${node.name}@${node.version}`)
}

function makeNodeKey(node: DagNode, paramsHash: Hash, nodeCodeHash: Hash): string {
  return JSON.stringify({
    cacheFormatVersion: 2,
    nodeId: node.name,
    nodeVersion: node.version,
    nodeCodeHash,
    paramsHash,
  })
}

// -----------------------------
// Node registry & createNode
// -----------------------------

// Registry is generic over unknown, we cast when inserting
const nodeRegistry = new Map<string, DagNode>()
const defaultPolicyRegistry: Record<string, NodePolicy> = {}
const explodeMetaRegistry = new WeakMap<DagNode, { sourceNode: DagNode; path: string }>()

// For AI/docs if needed
export function getRegisteredNodes() {
  return Array.from(nodeRegistry.values())
}

export function getDefaultNodePolicies(): Record<string, NodePolicy> {
  return { ...defaultPolicyRegistry }
}

const combinedParams = <A extends DagJsonSchema, B extends DagJsonSchema>(p1: A, p2: B) =>
  combineObjectSchemas(p1, p2)

type OneOfInput<Options extends readonly DagNode[]> = {
  kind: 'oneOf'
  options: Options
}

type ExposedInputDef = DagNode | OneOfInput<readonly DagNode[]>
export type DagExposedInputDef = ExposedInputDef

function isOneOfInput(value: ExposedInputDef): value is OneOfInput<readonly DagNode[]> {
  return typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'oneOf'
}

function oneOfSchemaFromInput(def: OneOfInput<readonly DagNode[]>): DagJsonSchema {
  // Optional by default: resolver can auto-pick first valid provider.
  // If providers need explicit params, users can still pass params in call(...)/study(...).
  return oneOfSchema(def.options.map((n) => n.paramsSchema))
}

function schemaFromInputs<T extends Record<string, ExposedInputDef>>(defs: T): DagJsonSchema {
  const properties: Record<string, DagJsonSchema> = {}
  const required: string[] = []
  for (const k in defs) {
    const def = defs[k]!
    properties[k] = isOneOfInput(def) ? oneOfSchemaFromInput(def) : def.paramsSchema
    if (!isOneOfInput(def)) required.push(k)
  }
  return objectSchema({ properties, required, additionalProperties: false })
}

type OutputOf<N> = N extends DagNode<unknown, infer O, DagJsonSchema, DagJsonSchema> ? O : never
type ParamsOf<N> = N extends DagNode<infer P, unknown, DagJsonSchema, DagJsonSchema> ? P : never
type OutputOfInput<I> =
  I extends DagNode<unknown, infer O, DagJsonSchema, DagJsonSchema>
    ? O
    : I extends OneOfInput<infer Options>
      ? OutputOf<Options[number]>
      : never
type ParamsOfInput<I> =
  I extends DagNode<infer P, unknown, DagJsonSchema, DagJsonSchema>
    ? P
    : I extends OneOfInput<infer Options>
      ? ParamsOf<Options[number]>
      : never
type OptionalInputKeys<E> = {
  [K in keyof E]: E[K] extends OneOfInput<readonly DagNode[]> ? K : never
}[keyof E]
type RequiredInputKeys<E> = Exclude<keyof E, OptionalInputKeys<E>>
type NodeParams<E> = {
  [K in RequiredInputKeys<E>]: ParamsOfInput<E[K]>
} & {
  [K in OptionalInputKeys<E>]?: ParamsOfInput<E[K]>
}

type ArrayPaths<T> = T extends object
  ? {
      [K in Extract<keyof T, string>]:
        | (T[K] extends ReadonlyArray<unknown> ? K : never)
        | (T[K] extends object ? `${K}.${ArrayPaths<T[K]>}` : never)
    }[Extract<keyof T, string>]
  : never

type PathValue<T, P extends string> = P extends `${infer K}.${infer Rest}`
  ? K extends keyof T
    ? PathValue<T[K], Rest>
    : never
  : P extends keyof T
    ? T[P]
    : never

const getObjectPathValue = (source: unknown, path: string): unknown => {
  if (!path) return source
  const parts = path.split('.')
  let current: unknown = source

  for (const key of parts) {
    if (typeof current !== 'object' || current === null) return undefined
    current = (current as Record<string, unknown>)[key]
  }

  return current
}

const splitCapturePath = (path: string): { root: string; nestedPath: string } => {
  const firstDot = path.indexOf('.')
  if (firstDot === -1) return { root: path, nestedPath: '' }
  return {
    root: path.slice(0, firstDot),
    nestedPath: path.slice(firstDot + 1),
  }
}

const resolveExposedCaptureValue = async (args: {
  node: DagNode
  alias: string
  runParams: Record<string, unknown>
  combo: Record<string, { sourceIndex: number; runOrderIndex: number }>
  byAlias: Map<string, ResolvedExplodedInput>
  actualCtx: NodeContext
  actualEngineConfig: EngineConfig
}): Promise<unknown> => {
  const comboEntry = args.combo[args.alias]
  const resolved = args.byAlias.get(args.alias)
  if (comboEntry && resolved) {
    return resolved.arr[comboEntry.sourceIndex]
  }

  const inputDef = args.node.exposedInputs?.[args.alias]
  if (!inputDef) return undefined

  const aliasParamsRaw = args.runParams[args.alias]
  const aliasParams =
    typeof aliasParamsRaw === 'object' && aliasParamsRaw !== null
      ? (aliasParamsRaw as Record<string, unknown>)
      : {}
  const childNode = selectInputNodeByParams(inputDef, undefined, [aliasParams, args.runParams, {}])
  if (!childNode) return undefined

  const { value } = await executeNode(
    childNode,
    aliasParams,
    args.actualCtx,
    args.actualEngineConfig,
  )
  return value
}

const resolveCapturedValue = async (args: {
  node: DagNode
  path: string
  runParams: Record<string, unknown>
  resultRow: unknown
  combo: Record<string, { sourceIndex: number; runOrderIndex: number }>
  byAlias: Map<string, ResolvedExplodedInput>
  actualCtx: NodeContext
  actualEngineConfig: EngineConfig
}): Promise<unknown> => {
  const { root, nestedPath } = splitCapturePath(args.path)
  if (root === 'params') return getObjectPathValue(args.runParams, nestedPath)
  if (root === 'outputs') return getObjectPathValue(args.resultRow, nestedPath)

  if (args.node.exposedInputs?.[root]) {
    const value = await resolveExposedCaptureValue({
      node: args.node,
      alias: root,
      runParams: args.runParams,
      combo: args.combo,
      byAlias: args.byAlias,
      actualCtx: args.actualCtx,
      actualEngineConfig: args.actualEngineConfig,
    })
    return getObjectPathValue(value, nestedPath)
  }

  const hiddenNode = args.node.hiddenInputs?.[root]
  if (!hiddenNode) return undefined
  const { value } = await executeNode(
    hiddenNode,
    args.runParams,
    args.actualCtx,
    args.actualEngineConfig,
  )
  return getObjectPathValue(value, nestedPath)
}

const cloneValue = <T>(value: T): T => {
  const sc = (globalThis as unknown as { structuredClone?: (v: unknown) => unknown })
    .structuredClone
  if (typeof sc === 'function') {
    try {
      return sc(value) as T
    } catch {
      // fall through
    }
  }
  return JSON.parse(JSON.stringify(value)) as T
}

const sortBySpecs = (items: unknown[], specs: SortSpec[] | undefined): number[] => {
  const indices = items.map((_, i) => i)
  if (!specs || specs.length === 0) return indices
  // NOTE: this is a static sort over source rows before execution starts.
  // It does not do adaptive scheduling (for example nearest-neighbor from
  // last completed row, hotspot frontier expansion, or objective-aware requeueing).
  indices.sort((a, b) => {
    const va = items[a]
    const vb = items[b]
    for (const spec of specs) {
      const da = getObjectPathValue(va, spec.path)
      const db = getObjectPathValue(vb, spec.path)
      if (da === db) continue
      const dir = spec.direction === 'asc' ? 1 : -1
      if (typeof da === 'number' && typeof db === 'number') return (da - db) * dir
      return String(da).localeCompare(String(db)) * dir
    }
    return 0
  })
  return indices
}

const selectInputNode = (
  input: ExposedInputDef,
  provider: string | number | undefined,
): DagNode | null => {
  if (!isOneOfInput(input)) return input

  if (typeof provider === 'number') {
    return input.options[provider] ?? null
  }
  if (typeof provider === 'string') {
    return input.options.find((n) => n.name === provider) ?? null
  }
  return input.options[0] ?? null
}

const selectInputNodeByParams = (
  input: ExposedInputDef,
  provider: string | number | undefined,
  candidateParams: Record<string, unknown>[],
): DagNode | null => {
  if (!isOneOfInput(input)) return input
  if (provider !== undefined) return selectInputNode(input, provider)

  const matches = input.options.filter((node) =>
    candidateParams.some((candidate) => safeParseSchema(node.paramsSchema, candidate).success),
  )

  if (matches.length === 1) return matches[0]!
  if (matches.length > 1) return matches[0]!
  return input.options[0] ?? null
}

const getExplodeMeta = (node: DagNode): { sourceNode: DagNode; path: string } | null => {
  return explodeMetaRegistry.get(node) ?? null
}

export type ExploreInputDebugInfo = {
  alias: string
  providers: string[]
  isExploded: boolean
  description: string
  explode?: {
    sourceNodeName: string
    sourcePath: string
  }
}

export const describeExploreInputs = (node: {
  exposedInputs?: Record<string, unknown> | undefined
}): ExploreInputDebugInfo[] => {
  const exposedRaw = node.exposedInputs
  if (!exposedRaw || typeof exposedRaw !== 'object') return []

  const exposed = exposedRaw as Record<string, ExposedInputDef>
  const out: ExploreInputDebugInfo[] = []

  for (const alias of Object.keys(exposed)) {
    const def = exposed[alias]!
    const providers = isOneOfInput(def) ? def.options.map((p) => p.name) : [def.name]
    const firstProvider = isOneOfInput(def) ? def.options[0] : def
    const explodeMeta = firstProvider ? getExplodeMeta(firstProvider) : null
    const isExploded = !!explodeMeta
    const explodeOutputDescription =
      explodeMeta &&
      schemaDescription(schemaAtPath(explodeMeta.sourceNode.outputSchema, explodeMeta.path))
    out.push({
      alias,
      providers,
      isExploded,
      description: isExploded
        ? (explodeOutputDescription ??
          'Exploded input: rows are evaluated item-by-item. Sorting and reverse-map settings control row order and stable IDs for streaming.')
        : 'Direct input: evaluated as one call unless a provider adds explode behavior.',
      ...(explodeMeta
        ? {
            explode: {
              sourceNodeName: explodeMeta.sourceNode.name,
              sourcePath: explodeMeta.path,
            },
          }
        : {}),
    })
  }

  return out
}

const resolveSourceParamsForExplodedInput = (
  alias: string,
  parentParams: Record<string, unknown>,
  explodedNode: DagNode,
): Record<string, unknown> => {
  const explodeMeta = getExplodeMeta(explodedNode)
  if (!explodeMeta) {
    throw new Error(`Node ${explodedNode.name}: missing explode metadata.`)
  }

  const aliasRaw = parentParams[alias]
  const aliasParams =
    typeof aliasRaw === 'object' && aliasRaw !== null ? (aliasRaw as Record<string, unknown>) : {}

  const explicitSourceRaw = aliasParams.source
  const explicitSource =
    typeof explicitSourceRaw === 'object' && explicitSourceRaw !== null
      ? (explicitSourceRaw as Record<string, unknown>)
      : null

  // Resolve source params from parent + alias overrides.
  // This avoids a subtle defaulting bug where parsing empty alias params (`{}`)
  // can succeed early and mask meaningful values present in parentParams.
  const candidates: Record<string, unknown>[] = []
  if (explicitSource) candidates.push(explicitSource)
  candidates.push(aliasParams)
  candidates.push({})

  for (const candidate of candidates) {
    const merged = { ...parentParams, ...candidate }
    const parsed = safeParseSchema<Record<string, unknown>>(
      explodeMeta.sourceNode.paramsSchema,
      merged,
    )
    if (parsed.success) return parsed.data
  }

  const shapeKeys = Object.keys(
    (explodeMeta.sourceNode.paramsSchema as { properties?: Record<string, unknown> }).properties ??
      {},
  )
  const reason =
    shapeKeys.length > 0 ? `required keys: ${shapeKeys.join(', ')}` : 'no required keys'
  throw new Error(
    `Node ${explodedNode.name}: cannot infer source params for alias "${alias}" from call(...) params (${reason}).`,
  )
}

type ResolvedExplodedInput = {
  alias: string
  sourceNode: DagNode
  sourcePath: string
  sourceParams: Record<string, unknown>
  arr: unknown[]
  sourceIndices: number[]
  inputOpts: StudyInputOption | undefined
}

const getResolvedExplodedInputs = async (
  node: DagNode,
  paramsValue: Record<string, unknown>,
  opts: StudyOptions | undefined,
  actualCtx: NodeContext,
  actualEngineConfig: EngineConfig,
): Promise<ResolvedExplodedInput[]> => {
  const exposed = node.exposedInputs ?? {}
  const entries: ResolvedExplodedInput[] = []

  for (const alias of Object.keys(exposed)) {
    const def = exposed[alias]!
    const inputOpts = opts?.inputs?.[alias]
    const aliasCandidateRaw = paramsValue[alias]
    const aliasCandidate =
      typeof aliasCandidateRaw === 'object' && aliasCandidateRaw !== null
        ? (aliasCandidateRaw as Record<string, unknown>)
        : {}
    const selected = selectInputNodeByParams(def, inputOpts?.provider, [
      aliasCandidate,
      paramsValue,
      {},
    ])
    const providerCandidates = isOneOfInput(def) ? def.options.map((x) => x.name) : [def.name]
    const autoMatches = isOneOfInput(def)
      ? def.options
          .filter((candidateNode) =>
            [aliasCandidate, paramsValue, {}].some(
              (candidateParams) =>
                safeParseSchema(candidateNode.paramsSchema, candidateParams).success,
            ),
          )
          .map((x) => x.name)
      : [def.name]
    const explodeMeta = selected ? getExplodeMeta(selected) : null
    if (!selected || !explodeMeta) {
      actualCtx.log('Study input skipped (not exploded or no provider)', {
        node: node.name,
        alias,
        explicitProvider: inputOpts?.provider ?? null,
        providerCandidates,
        autoMatches,
        selectedProvider: selected?.name ?? null,
        hasExplodeMeta: !!explodeMeta,
      })
      continue
    }

    actualCtx.log('Study input provider resolved', {
      node: node.name,
      alias,
      explicitProvider: inputOpts?.provider ?? null,
      providerCandidates,
      autoMatches,
      selectedProvider: selected.name,
      sourceNode: explodeMeta.sourceNode.name,
      sourcePath: explodeMeta.path,
      inputMode: inputOpts?.mode ?? 'cross',
      zipGroup: inputOpts?.zipGroup ?? null,
    })

    const sourceParams = resolveSourceParamsForExplodedInput(alias, paramsValue, selected)
    const sourceRun = await executeNode(
      explodeMeta.sourceNode,
      sourceParams,
      actualCtx,
      actualEngineConfig,
    )
    const arr = getObjectPathValue(sourceRun.value, explodeMeta.path)
    if (!Array.isArray(arr)) {
      throw new Error(
        `Node ${node.name}: exploded path ${explodeMeta.sourceNode.name}.${explodeMeta.path} is not an array at runtime.`,
      )
    }
    const sourceIndices = sortBySpecs(arr, inputOpts?.sortBy)

    actualCtx.log('Study exploded source resolved', {
      node: node.name,
      alias,
      provider: selected.name,
      sourceNode: explodeMeta.sourceNode.name,
      sourcePath: explodeMeta.path,
      sourceParams,
      sourceArrayLength: arr.length,
      sortedIndexCount: sourceIndices.length,
    })

    entries.push({
      alias,
      sourceNode: explodeMeta.sourceNode,
      sourcePath: explodeMeta.path,
      sourceParams,
      arr,
      sourceIndices,
      inputOpts,
    })
  }

  return entries
}

const estimatePlanRows = (resolved: ResolvedExplodedInput[]): number => {
  if (resolved.length === 0) return 1
  const zipGroups = new Map<string, number[]>()
  let crossProduct = 1

  for (const entry of resolved) {
    const mode = entry.inputOpts?.mode ?? 'cross'
    if (mode === 'zip') {
      const group = entry.inputOpts?.zipGroup ?? 'default'
      const prev = zipGroups.get(group) ?? []
      prev.push(entry.sourceIndices.length)
      zipGroups.set(group, prev)
      continue
    }
    crossProduct *= entry.sourceIndices.length
  }

  for (const lengths of zipGroups.values()) {
    const zippedLen = lengths.reduce((acc, n) => Math.min(acc, n), Number.POSITIVE_INFINITY)
    crossProduct *= Number.isFinite(zippedLen) ? zippedLen : 0
  }

  return crossProduct
}

const buildStudyPlanFromResolved = (
  resolved: ResolvedExplodedInput[],
  opts: StudyOptions | undefined,
  variableRuns: number,
): StudyPlan => {
  const explodedInputs: StudyAliasPlan[] = resolved.map((entry) => {
    const provider = opts?.inputs?.[entry.alias]?.provider
    const mode = entry.inputOpts?.mode ?? 'cross'
    const base: StudyAliasPlan = {
      alias: entry.alias,
      sourceNodeName: entry.sourceNode.name,
      sourcePath: entry.sourcePath,
      length: entry.sourceIndices.length,
      mode,
    }
    if (provider !== undefined) base.provider = provider
    if (mode === 'zip') base.zipGroup = entry.inputOpts?.zipGroup ?? 'default'
    return base
  })
  return {
    explodedInputs,
    variableRuns,
    estimatedRows: estimatePlanRows(resolved) * variableRuns,
  }
}

const buildExplodedCombinations = (
  resolved: ResolvedExplodedInput[],
): Array<Record<string, { sourceIndex: number; runOrderIndex: number }>> => {
  if (resolved.length === 0) return [{}]

  const crossEntries = resolved.filter((e) => (e.inputOpts?.mode ?? 'cross') !== 'zip')
  const zipGroups = new Map<string, ResolvedExplodedInput[]>()
  for (const entry of resolved) {
    if ((entry.inputOpts?.mode ?? 'cross') !== 'zip') continue
    const group = entry.inputOpts?.zipGroup ?? 'default'
    const prev = zipGroups.get(group) ?? []
    prev.push(entry)
    zipGroups.set(group, prev)
  }

  let combinations: Array<Record<string, { sourceIndex: number; runOrderIndex: number }>> = [{}]

  for (const entry of crossEntries) {
    const next: Array<Record<string, { sourceIndex: number; runOrderIndex: number }>> = []
    for (const base of combinations) {
      for (let runOrderIndex = 0; runOrderIndex < entry.sourceIndices.length; runOrderIndex++) {
        const sourceIndex = entry.sourceIndices[runOrderIndex]!
        next.push({
          ...base,
          [entry.alias]: { sourceIndex, runOrderIndex },
        })
      }
    }
    combinations = next
  }

  for (const entries of zipGroups.values()) {
    const zipLength = entries.reduce(
      (acc, e) => Math.min(acc, e.sourceIndices.length),
      Number.POSITIVE_INFINITY,
    )
    const boundedZipLength = Number.isFinite(zipLength) ? zipLength : 0
    const next: Array<Record<string, { sourceIndex: number; runOrderIndex: number }>> = []
    for (const base of combinations) {
      for (let runOrderIndex = 0; runOrderIndex < boundedZipLength; runOrderIndex++) {
        const zipped = { ...base }
        for (const entry of entries) {
          const sourceIndex = entry.sourceIndices[runOrderIndex]!
          zipped[entry.alias] = { sourceIndex, runOrderIndex }
        }
        next.push(zipped)
      }
    }
    combinations = next
  }

  return combinations
}

const buildVariableDimensions = (variables?: Record<string, StudyVariableSpec>) => {
  if (!variables) return [] as Array<{ path: string; values: unknown[] }>
  const dims: Array<{ path: string; values: unknown[] }> = []

  for (const [path, spec] of Object.entries(variables)) {
    switch (spec.kind) {
      case 'constant':
        if ('value' in spec) dims.push({ path, values: [spec.value] })
        continue
      case 'list':
      case 'grid': {
        if (!Array.isArray(spec.values) || spec.values.length === 0) {
          throw new Error(`Variable has no values: ${path}`)
        }
        dims.push({ path, values: spec.values })
        continue
      }
      case 'weightedList': {
        if (!Array.isArray(spec.values) || spec.values.length === 0) {
          throw new Error(`Variable has no values: ${path}`)
        }
        dims.push({
          path,
          values: spec.values.flatMap((entry) => {
            const repeat = Math.max(1, Math.round(Number(entry.weight ?? 1)))
            return Array.from({ length: repeat }, () => entry.value)
          }),
        })
        continue
      }
      case 'sweep': {
        if ((spec.method ?? 'linear') !== 'linear') {
          throw new Error(`Sweep method not implemented yet: ${spec.method ?? 'linear'} (${path})`)
        }
        if (!Number.isFinite(spec.step) || spec.step === 0) {
          throw new Error(`Sweep step must be a finite, non-zero number: ${path}`)
        }
        const out: number[] = []
        if (spec.step > 0) {
          for (let v = spec.start; v <= spec.end + 1e-12; v += spec.step) out.push(v)
        } else {
          for (let v = spec.start; v >= spec.end - 1e-12; v += spec.step) out.push(v)
        }
        if (out.length === 0) {
          throw new Error(`Sweep generated no values: ${path}`)
        }
        dims.push({ path, values: out })
        continue
      }
    }
  }

  return dims
}

const buildCombinations = (
  dims: Array<{ path: string; values: unknown[] }>,
): Record<string, unknown>[] => {
  if (dims.length === 0) return [{}]
  const [head, ...tail] = dims
  const tailCombos = buildCombinations(tail)
  const out: Record<string, unknown>[] = []
  for (const v of head!.values) {
    for (const combo of tailCombos) {
      out.push({ ...combo, [head!.path]: v })
    }
  }
  return out
}

const setPathValue = (target: Record<string, unknown>, path: string, value: unknown) => {
  const parts = path.split('.')
  let current: Record<string, unknown> = target

  for (let i = 0; i < parts.length; i++) {
    const key = parts[i]!
    if (i === parts.length - 1) {
      current[key] = value
      return
    }
    const next = current[key]
    if (typeof next !== 'object' || next === null) current[key] = {}
    current = current[key] as Record<string, unknown>
  }
}

const createRandom = (seed?: number): (() => number) => {
  if (!Number.isFinite(seed)) return Math.random
  let state = (seed as number) >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const createSequentialStudyStrategy = (): StudyInputStrategy => {
  return (ctx) => [...ctx.remainingIndices]
}

export const createNearestByLatLonStudyStrategy = (args?: {
  latPath?: string
  lonPath?: string
  randomFraction?: number
}): StudyInputStrategy => {
  const latPath = args?.latPath ?? 'centerLat'
  const lonPath = args?.lonPath ?? 'centerLon'
  const randomFraction = Math.min(1, Math.max(0, args?.randomFraction ?? 0))

  return (ctx) => {
    const remaining = [...ctx.remainingIndices]
    if (remaining.length <= 1) return remaining

    let anchorIndex: number | null = null
    if (ctx.history.length > 0) {
      const scored = ctx.history
        .filter((h) => h.objectiveValue !== null)
        .sort((a, b) => {
          if (!ctx.objective || ctx.objective.direction === 'max') {
            return (b.objectiveValue as number) - (a.objectiveValue as number)
          }
          return (a.objectiveValue as number) - (b.objectiveValue as number)
        })
      const best = scored[0] ?? ctx.history[ctx.history.length - 1]
      anchorIndex = best?.sourceIndexByAlias[ctx.alias] ?? null
    }
    if (anchorIndex === null) anchorIndex = remaining[0] ?? null
    if (anchorIndex === null) return remaining

    const lat0 = Number(ctx.getCandidateValue(anchorIndex, latPath))
    const lon0 = Number(ctx.getCandidateValue(anchorIndex, lonPath))
    if (!Number.isFinite(lat0) || !Number.isFinite(lon0)) return remaining

    remaining.sort((a, b) => {
      const latA = Number(ctx.getCandidateValue(a, latPath))
      const lonA = Number(ctx.getCandidateValue(a, lonPath))
      const latB = Number(ctx.getCandidateValue(b, latPath))
      const lonB = Number(ctx.getCandidateValue(b, lonPath))
      const dA =
        Number.isFinite(latA) && Number.isFinite(lonA)
          ? (latA - lat0) ** 2 + (lonA - lon0) ** 2
          : Number.POSITIVE_INFINITY
      const dB =
        Number.isFinite(latB) && Number.isFinite(lonB)
          ? (latB - lat0) ** 2 + (lonB - lon0) ** 2
          : Number.POSITIVE_INFINITY
      return dA - dB
    })

    if (randomFraction <= 0) return remaining
    const randomCount = Math.floor(remaining.length * randomFraction)
    if (randomCount <= 0) return remaining

    const randomFirst: number[] = []
    const pool = [...remaining]
    while (randomFirst.length < randomCount && pool.length > 0) {
      const idx = Math.floor(ctx.random() * pool.length)
      randomFirst.push(pool[idx]!)
      pool.splice(idx, 1)
    }
    return [...randomFirst, ...pool]
  }
}

export function createNode<
  LocalParamsSchema extends DagJsonSchema = typeof emptyObjectSchema,
  OSchema extends DagJsonSchema = DagJsonSchema,
  HiddenInputs extends Record<string, DagNode> = Record<never, never>,
  ExposedInputs extends Record<string, ExposedInputDef> = Record<never, never>,
  P = NodeParams<ExposedInputs> & DagSchemaType<LocalParamsSchema>,
  O = DagSchemaType<OSchema>,
>(args: {
  name: string
  localName?: string
  contentHash?: Hash
  version: number

  hiddenInputs?: HiddenInputs
  exposedInputs?: ExposedInputs
  localParams?: LocalParamsSchema

  outputSchema: OSchema
  policy?: NodePolicy

  run: (
    params: P,
    helpers: {
      [K in keyof ExposedInputs]: (
        maybeParams?: ParamsOfInput<ExposedInputs[K]>,
        opts?: { ctx?: NodeContext },
      ) => Promise<OutputOfInput<ExposedInputs[K]>>
    } & {
      [K in keyof HiddenInputs]: (
        maybeParams?: ParamsOf<HiddenInputs[K]>,
        opts?: { ctx?: NodeContext },
      ) => Promise<OutputOf<HiddenInputs[K]>>
    },
    ctx?: NodeContext,
  ) => Promise<O> | O
}) {
  const {
    name,
    localName,
    contentHash,
    version,
    exposedInputs,
    hiddenInputs,
    localParams,
    outputSchema,
    policy,
    run,
  } = args

  const paramsSchema = combinedParams(
    localParams ?? emptyObjectSchema,
    exposedInputs ? schemaFromInputs(exposedInputs) : emptyObjectSchema,
  )

  const defaultPolicy: NodePolicy = policy ?? {
    cache: 'ReadWrite',
    scope: 'Debug',
  }

  defaultPolicyRegistry[name] = defaultPolicy

  // The node methods close over the final node object for recursive execution paths.
  // eslint-disable-next-line prefer-const
  let node!: DagNode<P, O>
  const nodeImpl: DagNode<P, O> = {
    name,
    ...(localName ? { localName } : {}),
    ...(contentHash ? { contentHash } : {}),
    version,
    paramsSchema,
    outputSchema,
    defaultPolicy,
    hiddenInputs,
    exposedInputs,

    _runImpl: (params: unknown, helpers: unknown, ctx?: NodeContext) =>
      run(
        params as P,
        helpers as {
          [K in keyof ExposedInputs]: (
            maybeParams?: ParamsOfInput<ExposedInputs[K]>,
            opts?: { ctx?: NodeContext },
          ) => Promise<OutputOfInput<ExposedInputs[K]>>
        } & {
          [K in keyof HiddenInputs]: (
            maybeParams?: ParamsOf<HiddenInputs[K]>,
            opts?: { ctx?: NodeContext },
          ) => Promise<OutputOf<HiddenInputs[K]>>
        },
        ctx,
      ),

    call: (paramsValue: P) => ({
      node,
      params: paramsValue,
      run: async (ctx?: NodeContext, engineConfig?: EngineConfig) => {
        if (!ctx) {
          ctx = {
            nowUtcMs: Date.now(),
            log: (msg: string, data?: unknown) => console.log(msg, data ?? ''),
          }
        }
        const actualEngineConfig = engineConfig ?? {}
        const executionMode: DagExecutionMode = actualEngineConfig.execution?.mode ?? 'worker'
        const allowLocalFallback = actualEngineConfig.execution?.allowLocalFallback ?? true
        const runNodeInRunner = actualEngineConfig.execution?.runner?.runNode

        if (executionMode === 'worker' && runNodeInRunner) {
          const backend = actualEngineConfig.storageBackend ?? getDefaultInMemoryBackend()
          const validatedParams = parseSchema<unknown>(
            node.paramsSchema,
            paramsValue as Record<string, unknown>,
          )
          const paramsHash = executionParamsHash(
            validatedParams as Record<string, unknown>,
            actualEngineConfig,
          )
          const nodeCodeHash = getNodeCodeHash(node)
          const key = makeNodeKey(node, paramsHash, nodeCodeHash)
          const policy = actualEngineConfig.nodePolicies?.[node.name] ?? node.defaultPolicy

          if (policy.cache === 'ReadOnly' || policy.cache === 'ReadWrite') {
            const cached = await backend.getCacheEntry(key)
            if (cached) {
              const value = await backend.readArtifact(cached.artifact)
              return { value: value as O, artifactHash: cached.artifact } as {
                value: O
                artifactHash: Hash
              }
            }
          }

          const workerResult = await runNodeInRunner({
            node,
            params: paramsValue,
            ctx,
            engineConfig: actualEngineConfig,
          })
          if (workerResult) {
            const value = parseSchema<unknown>(node.outputSchema, workerResult.value)
            const artifactHash = workerResult.artifactHash ?? (await backend.writeArtifact(value))
            if (policy.cache === 'WriteOnly' || policy.cache === 'ReadWrite') {
              await backend.setCacheEntry(key, { artifact: artifactHash })
            }
            return {
              value,
              artifactHash,
            } as { value: O; artifactHash: Hash }
          }
        }

        if (executionMode === 'worker' && !allowLocalFallback) {
          throw new Error(
            `Node ${node.name}: worker execution unavailable and local fallback disabled.`,
          )
        }

        const { value, artifactHash } = await executeNode(
          node,
          paramsValue as Record<string, unknown>,
          ctx,
          actualEngineConfig,
        )

        return { value: value as O, artifactHash } as { value: O; artifactHash: Hash }
      },
      study: async (opts?: StudyOptions, ctx?: NodeContext, engineConfig?: EngineConfig) => {
        const actualCtx = ctx ?? {
          nowUtcMs: Date.now(),
          log: (msg: string, data?: unknown) => console.log(msg, data ?? ''),
        }
        const actualEngineConfig = engineConfig ?? {}
        const executionMode: DagExecutionMode = actualEngineConfig.execution?.mode ?? 'worker'
        const allowLocalFallback = actualEngineConfig.execution?.allowLocalFallback ?? true
        const runStudyInRunner = actualEngineConfig.execution?.runner?.runStudy
        if (executionMode === 'worker' && runStudyInRunner) {
          const workerResult = await runStudyInRunner(
            opts === undefined
              ? {
                  node,
                  params: paramsValue,
                  ctx: actualCtx,
                  engineConfig: actualEngineConfig,
                }
              : {
                  node,
                  params: paramsValue,
                  opts,
                  ctx: actualCtx,
                  engineConfig: actualEngineConfig,
                },
          )
          if (workerResult) return workerResult
        }
        if (executionMode === 'worker' && !allowLocalFallback) {
          throw new Error(
            `Node ${node.name}: worker study execution unavailable and local fallback disabled.`,
          )
        }
        const random = createRandom(opts?.rngSeed)
        const mode = opts?.mode ?? 'explore'
        const objective = opts?.objective

        if (mode === 'optimize' && !objective) {
          throw new Error(`Node ${node.name}: study(mode=optimize) requires objective.`)
        }

        const variableDims = buildVariableDimensions(opts?.variables)
        const variableRuns = buildCombinations(variableDims)
        const resolved = await getResolvedExplodedInputs(
          node,
          paramsValue as Record<string, unknown>,
          opts,
          actualCtx,
          actualEngineConfig,
        )

        for (const entry of resolved) {
          const strategy = entry.inputOpts?.strategy
          if (!strategy || entry.sourceIndices.length <= 1) continue
          const proposedRaw = await strategy({
            alias: entry.alias,
            candidates: entry.arr,
            remainingIndices: [...entry.sourceIndices],
            evaluatedIndices: [],
            history: [],
            ...(objective ? { objective } : {}),
            getCandidateValue: (index, path) => getObjectPathValue(entry.arr[index], path),
            random,
          })
          const proposed = proposedRaw.filter((i) => Number.isInteger(i))
          const used = new Set<number>()
          const merged = [...proposed, ...entry.sourceIndices].filter((i) => {
            if (i < 0 || i >= entry.arr.length) return false
            if (used.has(i)) return false
            used.add(i)
            return true
          })
          entry.sourceIndices = merged
        }

        const plan = opts?.plan ?? buildStudyPlanFromResolved(resolved, opts, variableRuns.length)
        if (opts?.dryRun) {
          return {
            rows: [],
            rowKeys: [],
            plan,
            bestIndex: null,
            best: null,
            completedEvals: 0,
            stoppedReason: null,
          }
        }

        const rows: O[] = []
        const rowKeys: Record<string, string | number>[] = []
        const history: StudyHistoryEntry<O>[] = []
        const byAlias = new Map(resolved.map((e) => [e.alias, e]))
        const startMs = Date.now()
        const maxRows = opts?.budget?.maxRows
        const maxEvals = opts?.budget?.maxEvals
        const timeMs = opts?.budget?.timeMs

        let bestIndex: number | null = null
        let bestObjectiveValue: number | null = null
        let completedEvals = 0
        let stoppedReason: 'maxRows' | 'maxEvals' | 'timeMs' | null = null
        let yieldedRowsCounter = 0
        const yieldEveryRows = Math.max(1, actualEngineConfig.execution?.yieldEveryRows ?? 20)
        const maybeYieldToUi = async () => {
          yieldedRowsCounter += 1
          if (yieldedRowsCounter % yieldEveryRows !== 0) return
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 0)
          })
        }

        const shouldStop = () => {
          if (maxRows !== undefined && rows.length >= maxRows) return 'maxRows' as const
          if (maxEvals !== undefined && completedEvals >= maxEvals) return 'maxEvals' as const
          if (timeMs !== undefined && Date.now() - startMs >= timeMs) return 'timeMs' as const
          return null
        }

        const runCombo = async (
          baseParams: Record<string, unknown>,
          combo: Record<string, { sourceIndex: number; runOrderIndex: number }>,
          variablePatch: Record<string, unknown>,
        ) => {
          const runParams = cloneValue(baseParams)
          const keyRow: Record<string, string | number> = {}
          const sourceIndexByAlias: Record<string, number> = {}

          for (const [path, value] of Object.entries(variablePatch)) {
            keyRow[path] =
              typeof value === 'string' || typeof value === 'number' ? value : JSON.stringify(value)
          }

          for (const alias of Object.keys(combo)) {
            const comboEntry = combo[alias]!
            const entry = byAlias.get(alias)
            if (!entry) continue
            const existingAliasRaw = runParams[alias]
            const existingAlias =
              typeof existingAliasRaw === 'object' && existingAliasRaw !== null
                ? (existingAliasRaw as Record<string, unknown>)
                : {}
            runParams[alias] = {
              ...entry.sourceParams,
              ...existingAlias,
              itemIndex: comboEntry.sourceIndex,
            }
            sourceIndexByAlias[alias] = comboEntry.sourceIndex
            const idVal = getObjectPathValue(entry.arr[comboEntry.sourceIndex], 'id')
            keyRow[alias] =
              typeof idVal === 'string' || typeof idVal === 'number'
                ? idVal
                : comboEntry.sourceIndex
          }

          const result = await node.call(runParams as P).run(actualCtx, actualEngineConfig)
          completedEvals += 1
          rows.push(result.value)
          rowKeys.push(keyRow)
          const capturedEntries = await Promise.all(
            (opts?.capture ?? []).map(async (spec: StudyCaptureSpec) => [
              spec.as ?? spec.path,
              await resolveCapturedValue({
                node,
                path: spec.path,
                runParams,
                resultRow: result.value,
                combo,
                byAlias,
                actualCtx,
                actualEngineConfig,
              }),
            ]),
          )
          const captured =
            capturedEntries.length > 0 ? Object.fromEntries(capturedEntries) : undefined
          const objectiveRaw = objective
            ? getObjectPathValue(result.value as unknown as Record<string, unknown>, objective.path)
            : undefined
          const objectiveValue =
            typeof objectiveRaw === 'number' && Number.isFinite(objectiveRaw) ? objectiveRaw : null

          if (objective && objectiveValue !== null) {
            if (bestIndex === null) {
              bestIndex = rows.length - 1
              bestObjectiveValue = objectiveValue
            } else {
              const better =
                objective.direction === 'max'
                  ? objectiveValue > (bestObjectiveValue as number)
                  : objectiveValue < (bestObjectiveValue as number)
              if (better) {
                bestIndex = rows.length - 1
                bestObjectiveValue = objectiveValue
              }
            }
          }

          history.push({
            rowIndex: rows.length - 1,
            row: result.value,
            rowKey: keyRow,
            sourceIndexByAlias,
            objectiveValue,
            ...(captured ? { captured } : {}),
          })

          await opts?.onRow?.({
            rowIndex: rows.length - 1,
            row: result.value,
            rowKey: keyRow,
            sourceIndexByAlias,
            objectiveValue,
            ...(captured ? { captured } : {}),
          })
          await maybeYieldToUi()
        }

        for (const patch of variableRuns) {
          if (stoppedReason) break
          const baseParams = cloneValue(paramsValue) as Record<string, unknown>
          for (const [path, value] of Object.entries(patch)) {
            setPathValue(baseParams, path, value)
          }
          const validatedBase = parseSchema<Record<string, unknown>>(node.paramsSchema, baseParams)

          if (resolved.length === 0) {
            const stop = shouldStop()
            if (stop) {
              stoppedReason = stop
              break
            }
            await runCombo(validatedBase, {}, patch)
            continue
          }

          if (
            resolved.length === 1 &&
            resolved[0]!.inputOpts?.strategy &&
            (resolved[0]!.inputOpts?.mode ?? 'cross') !== 'zip'
          ) {
            const entry = resolved[0]!
            const evaluated = new Set<number>()
            while (evaluated.size < entry.sourceIndices.length) {
              const stop = shouldStop()
              if (stop) {
                stoppedReason = stop
                break
              }
              const remaining = entry.sourceIndices.filter((i) => !evaluated.has(i))
              if (remaining.length === 0) break
              const proposedRaw = await (entry.inputOpts?.strategy as StudyInputStrategy)({
                alias: entry.alias,
                candidates: entry.arr,
                remainingIndices: remaining,
                evaluatedIndices: [...evaluated],
                history,
                ...(objective ? { objective } : {}),
                getCandidateValue: (index, path) => getObjectPathValue(entry.arr[index], path),
                random,
              })
              const proposed = proposedRaw.filter((i) => remaining.includes(i))
              const next = proposed[0] ?? remaining[0]!
              evaluated.add(next)
              await runCombo(
                validatedBase,
                {
                  [entry.alias]: {
                    sourceIndex: next,
                    runOrderIndex: evaluated.size - 1,
                  },
                },
                patch,
              )
            }
            continue
          }

          const combinations = buildExplodedCombinations(resolved)
          for (const combo of combinations) {
            const stop = shouldStop()
            if (stop) {
              stoppedReason = stop
              break
            }
            await runCombo(validatedBase, combo, patch)
          }
        }

        return {
          rows,
          rowKeys,
          plan,
          bestIndex,
          best: bestIndex === null ? null : rows[bestIndex]!,
          completedEvals,
          stoppedReason,
        }
      },
    }),
  }
  node = nodeImpl
  nodeRegistry.set(name, node as unknown as DagNode<unknown, unknown>)

  return node
}

export function oneOf<const Options extends readonly DagNode[]>(
  options: Options,
): OneOfInput<Options> {
  return { kind: 'oneOf', options }
}

export function explode<
  SourceNode extends DagNode,
  Path extends (ArrayPaths<OutputOf<SourceNode>> & string) | (string & {}),
>(
  sourceNode: SourceNode,
  path: Path,
  identity?: {
    name?: string
    localName?: string
    contentHash?: Hash
    version?: number
    outputSchema?: DagJsonSchema
  },
) {
  type SourceOutput = OutputOf<SourceNode>
  type SelectedArray = PathValue<SourceOutput, Path>
  type Item = SelectedArray extends ReadonlyArray<infer TItem> ? TItem : never

  const selectedSchema = schemaAtPath(sourceNode.outputSchema, path)
  const elementSchema = selectedSchema ? schemaArrayElement(selectedSchema) : null
  if (!elementSchema) {
    throw new Error(
      `explode(${sourceNode?.name ?? 'unknown'}, ${path}): path must point to an array in outputSchema`,
    )
  }
  type ExplodedParams = ParamsOf<SourceNode> & { itemIndex?: number }
  const localParamsSchema = combinedParams(
    sourceNode.paramsSchema,
    objectSchema({
      properties: {
        itemIndex: {
          type: 'integer',
          minimum: 0,
          default: 0,
          description: 'Index into exploded array output from source node',
        },
      },
    }),
  )
  const outputSchema =
    identity?.outputSchema ??
    ({
      ...(typeof elementSchema === 'object' && elementSchema !== null ? elementSchema : {}),
      description: `Exploded element from ${sourceNode.name}.${path} at params.itemIndex`,
    } as DagJsonSchema)

  const explodedNode = createNode<
    DagJsonSchema,
    DagJsonSchema,
    Record<'source', SourceNode>,
    Record<never, never>,
    ExplodedParams,
    Item
  >({
    name: identity?.name ?? `${sourceNode.name}__explode__${path.replace(/\./g, '_')}`,
    ...(identity?.localName ? { localName: identity.localName } : {}),
    ...(identity?.contentHash ? { contentHash: identity.contentHash } : {}),
    version: identity?.version ?? 1,
    hiddenInputs: {
      source: sourceNode,
    },
    localParams: localParamsSchema,
    outputSchema,
    run: async (params, use) => {
      const sourceParams = { ...(params as Record<string, unknown>) }
      delete sourceParams.itemIndex
      const sourceOut = await use.source(sourceParams as ParamsOf<SourceNode>)
      const arr = getObjectPathValue(sourceOut, path)
      if (!Array.isArray(arr)) {
        throw new Error(
          `explode(${sourceNode.name}, ${path}) expected array at runtime, received ${typeof arr}`,
        )
      }
      const paramsRecord = params as Record<string, unknown>
      const itemIndex = typeof paramsRecord.itemIndex === 'number' ? paramsRecord.itemIndex : 0
      const item = arr[itemIndex]
      if (item === undefined) {
        throw new Error(
          `explode(${sourceNode.name}, ${path}) itemIndex out of bounds: ${itemIndex} (len=${arr.length})`,
        )
      }
      return item as Item
    },
  })

  explodeMetaRegistry.set(explodedNode as unknown as DagNode, { sourceNode, path })
  return explodedNode
}

// -----------------------------
// Node execution & `use`
// -----------------------------

export async function executeNode(
  node: DagNode,
  paramsValue: Record<string, unknown>,
  ctx: NodeContext,
  engineConfig: EngineConfig,
): Promise<{ value: unknown; artifactHash: Hash }> {
  // TODO: get rid of this global variable...  add it as a function argument...
  const backend = engineConfig.storageBackend ?? getDefaultInMemoryBackend()

  // TODO: it might make sense to make validation optional  for speed ups!
  const validatedParams = parseSchema<Record<string, unknown>>(node.paramsSchema, paramsValue)
  const paramsHash = executionParamsHash(validatedParams, engineConfig)
  const nodeCodeHash = getNodeCodeHash(node)
  const key = makeNodeKey(node, paramsHash, nodeCodeHash)

  const policy = engineConfig.nodePolicies?.[node.name] ?? node.defaultPolicy

  if (policy.cache === 'ReadOnly' || policy.cache === 'ReadWrite') {
    const cached = await backend.getCacheEntry(key)
    if (cached) {
      const value = await backend.readArtifact(cached.artifact)
      return { value, artifactHash: cached.artifact }
    }
  }

  const childEngineConfig = bindExposedInputParams(node, validatedParams, engineConfig)
  const addInputs = (
    inputs: Record<string, DagNode> | Record<string, ExposedInputDef> | undefined,
    expose: boolean,
  ) => {
    const use = {} as Record<string, unknown>
    if (!inputs) return
    for (const alias in inputs) {
      const inputDef = inputs[alias] as ExposedInputDef
      use[alias] = createExecutionWithChecks(
        expose,
        node,
        alias,
        validatedParams,
        inputDef,
        ctx,
        childEngineConfig,
      )
    }
    return use
  }
  const use = {
    ...addInputs(node.hiddenInputs, false),
    ...addInputs(node.exposedInputs, true),
  }

  const rawValue = await Promise.resolve(node._runImpl(validatedParams, use, ctx))
  const value = parseSchema(node.outputSchema, rawValue)
  const artifactHash = await backend.writeArtifact(value)

  if (policy.cache === 'WriteOnly' || policy.cache === 'ReadWrite') {
    await backend.setCacheEntry(key, { artifact: artifactHash })
  }

  return { value, artifactHash }
}

const createExecutionWithChecks =
  (
    expose: boolean,
    node: DagNode,
    alias: string,
    validatedParams: Record<string, unknown>,
    inputDef: ExposedInputDef,
    ctx: NodeContext,
    engineConfig: EngineConfig,
  ) =>
  async (maybeParams?: Record<string, unknown>, opts?: { ctx?: NodeContext }) => {
    const providerRaw = maybeParams?.__provider ?? validatedParams?.[`${alias}__provider`]
    const providerOverride =
      typeof providerRaw === 'string' || typeof providerRaw === 'number' ? providerRaw : undefined

    const parentAliasRaw = validatedParams[alias]
    const parentAliasParams =
      typeof parentAliasRaw === 'object' && parentAliasRaw !== null
        ? (parentAliasRaw as Record<string, unknown>)
        : {}

    let childParams: Record<string, unknown>

    if (maybeParams !== undefined) {
      // For exposed inputs, preserve alias params inferred by the parent call
      // (for example study-injected explode itemIndex), then apply explicit overrides.
      childParams = expose ? { ...parentAliasParams, ...maybeParams } : { ...maybeParams }
      delete childParams.__provider
    } else {
      if (!expose) {
        throw new Error(
          `Node ${node.name}: use.${alias}() called without params, but this input is internal and does not expose parent params. Please provide params explicitly when calling use.${alias}().`,
        )
      }
      // Default mapping: take from parent's validated params
      const pAny = validatedParams
      if (!(alias in pAny)) {
        childParams = {}
      } else {
        const candidate = pAny[alias]
        childParams =
          typeof candidate === 'object' && candidate !== null
            ? (candidate as Record<string, unknown>)
            : {}
      }
    }

    const childNode = selectInputNodeByParams(inputDef, providerOverride, [
      childParams,
      parentAliasParams,
      validatedParams,
      {},
    ])
    if (!childNode) {
      throw new Error(`Node ${node.name}: no provider resolved for input alias "${alias}".`)
    }

    childParams = {
      ...(engineConfig.parameterBindings?.[childNode.name] ?? {}),
      ...childParams,
    }

    // recursivly call child node
    const { value } = await executeNode(childNode, childParams, opts?.ctx ?? ctx, engineConfig)

    return value
  }

const bindExposedInputParams = (
  node: DagNode,
  params: Record<string, unknown>,
  engineConfig: EngineConfig,
): EngineConfig => {
  const additions = Object.entries(node.exposedInputs ?? {}).flatMap(([alias, input]) => {
    const value = params[alias]
    if ('kind' in input || typeof value !== 'object' || value === null || Array.isArray(value)) {
      return []
    }
    return [[input.name, value as Record<string, unknown>] as const]
  })
  if (additions.length === 0) return engineConfig
  return {
    ...engineConfig,
    parameterBindings: {
      ...Object.fromEntries(additions),
      ...(engineConfig.parameterBindings ?? {}),
    },
  }
}

const executionParamsHash = (params: Record<string, unknown>, engineConfig: EngineConfig): Hash =>
  canonicalHash(
    engineConfig.parameterBindings
      ? { params, parameterBindings: engineConfig.parameterBindings }
      : params,
  )
