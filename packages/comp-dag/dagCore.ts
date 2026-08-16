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
  createSourceLockManifest,
  shouldRefreshSource,
  type SourceManifestRepository,
  type SourceUpdatePolicy,
} from './sourceManifest.ts'
import { assertDagNodeEffectSource } from './dagNodeEffectCheck.ts'
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
export type DagNodeEffect = 'pure' | 'source'

interface NodePolicy {
  cache: CacheRule
  scope: ArtifactScope
}

export interface EngineConfig {
  nodePolicies?: Record<string, NodePolicy>
  storageBackend?: DagStorageBackend
  execution?: DagExecutionConfig
  parameterBindings?: Record<string, Record<string, unknown>>
  sliceExecution?: DagSliceExecutionPolicy
  sourceExecution?: {
    repository: SourceManifestRepository
    projectId?: string
    defaultPolicy: SourceUpdatePolicy
    nodePolicies?: Record<string, SourceUpdatePolicy>
    refreshedAcquisitionKeys: Set<Hash>
    forceNodeNames?: ReadonlySet<string>
  }
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
  collectRows?: boolean
  collectHistory?: boolean
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

export type DagSliceDomain =
  | { values: readonly unknown[] }
  | { range: readonly [number, number]; step?: number }

export type DagSliceParams<P = Record<string, unknown>> = {
  [K in keyof P]?: P[K] | DagSliceDomain
} & Record<string, unknown>

export type DagSliceExecutionPolicy = {
  resolveContinuousDomain?: (args: {
    node: DagNode
    path: string
    range: readonly [number, number]
  }) => StudyVariableSpec
}

export type DagQueryExecutionOptions = {
  budget?: StudyBudget
  capture?: StudyCaptureSpec[]
  inputs?: Record<string, StudyInputOption>
  onRow?: (event: StudyRowEvent) => void | Promise<void>
  rngSeed?: number
}

export type DagQuerySelection<O> = {
  index: number
  objectiveValue: number
  row: O
  rowKey: Record<string, string | number>
}

export type DagQueryBinding =
  | { source: 'row'; path?: string }
  | { source: 'rowKey'; path?: string }
  | { source: 'rows' }
  | { source: 'value'; value: unknown }

export interface DagSliceQuery<O> {
  collect(
    options?: DagQueryExecutionOptions,
    ctx?: NodeContext,
    engineConfig?: EngineConfig,
  ): Promise<StudyResult<O>>
  min(
    path: string,
    options?: DagQueryExecutionOptions,
    ctx?: NodeContext,
    engineConfig?: EngineConfig,
  ): Promise<number | null>
  max(
    path: string,
    options?: DagQueryExecutionOptions,
    ctx?: NodeContext,
    engineConfig?: EngineConfig,
  ): Promise<number | null>
  argmin(
    path: string,
    options?: DagQueryExecutionOptions,
    ctx?: NodeContext,
    engineConfig?: EngineConfig,
  ): Promise<DagQuerySelection<O> | null>
  argmax(
    path: string,
    options?: DagQueryExecutionOptions,
    ctx?: NodeContext,
    engineConfig?: EngineConfig,
  ): Promise<DagQuerySelection<O> | null>
  mean(
    path: string,
    options?: DagQueryExecutionOptions,
    ctx?: NodeContext,
    engineConfig?: EngineConfig,
  ): Promise<number | null>
  sum(
    path: string,
    options?: DagQueryExecutionOptions,
    ctx?: NodeContext,
    engineConfig?: EngineConfig,
  ): Promise<number>
  map<P, R>(
    target: DagInputAccessor<P, R>,
    bindings: Record<string, DagQueryBinding>,
    options?: DagQueryExecutionOptions,
    ctx?: NodeContext,
    engineConfig?: EngineConfig,
  ): Promise<StudyResult<R>>
  apply<P, R>(
    target: DagInputAccessor<P, R>,
    bindings: Record<string, DagQueryBinding>,
    options?: DagQueryExecutionOptions,
    ctx?: NodeContext,
    engineConfig?: EngineConfig,
  ): Promise<R>
}

export interface DagInputAccessor<P = Record<string, unknown>, O = unknown> {
  (params: P, opts?: { ctx?: NodeContext }): Promise<O>
  (params?: undefined, opts?: { ctx?: NodeContext }): Promise<O>
  readonly alias: string
  slice(params: DagSliceParams<P>): DagSliceQuery<O>
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
  description?: string | undefined
  contentHash?: Hash | undefined
  version: number
  effect: DagNodeEffect

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
    slice(params: DagSliceParams<P>): DagSliceQuery<O>
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

const dagExecutionLogData = (
  node: DagNode,
  status: 'running' | 'cached' | 'completed' | 'failed',
  error?: string,
) => ({
  taskyonDag: {
    nodeId: getNodeCodeHash(node),
    nodeName: node.name,
    status,
    ...(error ? { error } : {}),
  },
})

const makeNodeKey = (paramsHash: Hash, nodeCodeHash: Hash): Hash =>
  canonicalHash({ node: nodeCodeHash, params: paramsHash })

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

export const getDagExplodeMetadata = (
  node: DagNode,
): { sourceNode: DagNode; path: string } | null => {
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
    const explodeMeta = firstProvider ? getDagExplodeMetadata(firstProvider) : null
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
  const explodeMeta = getDagExplodeMetadata(explodedNode)
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
    const explodeMeta = selected ? getDagExplodeMetadata(selected) : null
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

const iterateExplodedCombinations = function* (
  resolved: ResolvedExplodedInput[],
): Iterable<Record<string, { sourceIndex: number; runOrderIndex: number }>> {
  const crossEntries = resolved.filter((e) => (e.inputOpts?.mode ?? 'cross') !== 'zip')
  const zipGroups = new Map<string, ResolvedExplodedInput[]>()
  for (const entry of resolved) {
    if ((entry.inputOpts?.mode ?? 'cross') !== 'zip') continue
    const group = entry.inputOpts?.zipGroup ?? 'default'
    const prev = zipGroups.get(group) ?? []
    prev.push(entry)
    zipGroups.set(group, prev)
  }

  const dimensions: Array<Array<Record<string, { sourceIndex: number; runOrderIndex: number }>>> = [
    ...crossEntries.map((entry) =>
      entry.sourceIndices.map((sourceIndex, runOrderIndex) => ({
        [entry.alias]: { sourceIndex, runOrderIndex },
      })),
    ),
    ...[...zipGroups.values()].map((entries) => {
      const zipLength = entries.reduce(
        (length, entry) => Math.min(length, entry.sourceIndices.length),
        Number.POSITIVE_INFINITY,
      )
      return Array.from(
        { length: Number.isFinite(zipLength) ? zipLength : 0 },
        (_, runOrderIndex) =>
          Object.fromEntries(
            entries.map((entry) => [
              entry.alias,
              { sourceIndex: entry.sourceIndices[runOrderIndex]!, runOrderIndex },
            ]),
          ),
      )
    }),
  ]
  const visit = function* (
    index: number,
    current: Record<string, { sourceIndex: number; runOrderIndex: number }>,
  ): Iterable<Record<string, { sourceIndex: number; runOrderIndex: number }>> {
    if (index === dimensions.length) {
      yield current
      return
    }
    for (const patch of dimensions[index]!) yield* visit(index + 1, { ...current, ...patch })
  }
  yield* visit(0, {})
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

const iterateCombinations = function* (
  dims: Array<{ path: string; values: unknown[] }>,
  index = 0,
  current: Record<string, unknown> = {},
): Iterable<Record<string, unknown>> {
  if (index === dims.length) {
    yield current
    return
  }
  const dimension = dims[index]!
  for (const value of dimension.values) {
    yield* iterateCombinations(dims, index + 1, { ...current, [dimension.path]: value })
  }
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

const deletePathValue = (target: Record<string, unknown>, path: string) => {
  const parts = path.split('.')
  let current: Record<string, unknown> = target
  for (let index = 0; index < parts.length - 1; index++) {
    const next = current[parts[index]!]
    if (typeof next !== 'object' || next === null || Array.isArray(next)) return
    current = next as Record<string, unknown>
  }
  delete current[parts[parts.length - 1]!]
}

const isValuesDomain = (value: unknown): value is { values: readonly unknown[] } => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  if (!('values' in value)) return false
  const keys = Object.keys(value)
  return keys.length === 1 && keys[0] === 'values' && Array.isArray(value.values)
}

const isRangeDomain = (
  value: unknown,
): value is { range: readonly [number, number]; step?: number } => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  if (!('range' in value)) return false
  const keys = Object.keys(value)
  if (keys.some((key) => key !== 'range' && key !== 'step')) return false
  if (!Array.isArray(value.range) || value.range.length !== 2) return false
  return value.range.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
}

const compileSliceParams = (
  node: DagNode,
  baseParams: Record<string, unknown>,
  sliceParams: Record<string, unknown>,
  engineConfig: EngineConfig,
): { params: Record<string, unknown>; variables: Record<string, StudyVariableSpec> } => {
  const params = cloneValue(baseParams)
  const variables: Record<string, StudyVariableSpec> = {}

  const visit = (value: unknown, path: string) => {
    if (isValuesDomain(value)) {
      if (value.values.length === 0) throw new Error(`Node ${node.name}: empty slice at ${path}.`)
      deletePathValue(params, path)
      variables[path] = { kind: 'list', values: [...value.values] }
      return
    }
    if (isRangeDomain(value)) {
      deletePathValue(params, path)
      const [start, end] = value.range
      if (value.step !== undefined) {
        variables[path] = { kind: 'sweep', start, end, step: value.step }
        return
      }
      const resolved = engineConfig.sliceExecution?.resolveContinuousDomain?.({
        node,
        path,
        range: value.range,
      })
      if (!resolved) {
        throw new Error(
          `Node ${node.name}: continuous slice ${path} requires an injected slice execution policy.`,
        )
      }
      variables[path] = resolved
      return
    }
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      for (const [key, nested] of Object.entries(value)) {
        visit(nested, path ? `${path}.${key}` : key)
      }
      return
    }
    setPathValue(params, path, value)
  }

  for (const [key, value] of Object.entries(sliceParams)) visit(value, key)
  return { params, variables }
}

const queryNumberValues = <O>(result: StudyResult<O>, path: string): number[] =>
  result.rows.map((row, index) => {
    const value = getObjectPathValue(row, path)
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`Query path "${path}" is not a finite number in row ${index}.`)
    }
    return value
  })

const querySelection = <O>(
  result: StudyResult<O>,
  path: string,
  direction: 'min' | 'max',
): DagQuerySelection<O> | null => {
  const values = queryNumberValues(result, path)
  if (values.length === 0) return null
  let selectedIndex = 0
  for (let index = 1; index < values.length; index++) {
    const candidate = values[index]!
    const selected = values[selectedIndex]!
    if (direction === 'min' ? candidate < selected : candidate > selected) {
      selectedIndex = index
    }
  }
  return {
    index: selectedIndex,
    objectiveValue: values[selectedIndex]!,
    row: result.rows[selectedIndex]!,
    rowKey: result.rowKeys[selectedIndex]!,
  }
}

const resolveQueryBinding = (
  binding: DagQueryBinding,
  values: {
    row?: unknown
    rowKey?: Record<string, string | number>
    rows: unknown[]
  },
): unknown => {
  switch (binding.source) {
    case 'row':
      return binding.path ? getObjectPathValue(values.row, binding.path) : values.row
    case 'rowKey':
      return binding.path ? getObjectPathValue(values.rowKey, binding.path) : values.rowKey
    case 'rows':
      return values.rows
    case 'value':
      return binding.value
  }
}

const resolveQueryBindings = (
  bindings: Record<string, DagQueryBinding>,
  values: {
    row?: unknown
    rowKey?: Record<string, string | number>
    rows: unknown[]
  },
): Record<string, unknown> => {
  const params: Record<string, unknown> = {}
  for (const [path, binding] of Object.entries(bindings)) {
    setPathValue(params, path, resolveQueryBinding(binding, values))
  }
  return params
}

const createDagSliceQuery = <P, O>(args: {
  node: DagNode<P, O>
  baseParams: Record<string, unknown>
  sliceParams: Record<string, unknown>
  defaultCtx?: NodeContext
  defaultEngineConfig?: EngineConfig
}): DagSliceQuery<O> => {
  const collect = async (
    options?: DagQueryExecutionOptions,
    ctx?: NodeContext,
    engineConfig?: EngineConfig,
    objective?: StudyObjective,
  ) => {
    const actualEngineConfig = engineConfig ?? args.defaultEngineConfig ?? {}
    const compiled = compileSliceParams(
      args.node,
      args.baseParams,
      args.sliceParams,
      actualEngineConfig,
    )
    const studyOptions: StudyOptions = {
      ...(options ?? {}),
      variables: compiled.variables,
      ...(objective ? { mode: 'optimize', objective } : {}),
    }
    return await args.node
      .call(compiled.params as P)
      .study(studyOptions, ctx ?? args.defaultCtx, actualEngineConfig)
  }

  const aggregate = async (
    path: string,
    operation: 'min' | 'max' | 'mean' | 'sum',
    options?: DagQueryExecutionOptions,
    ctx?: NodeContext,
    engineConfig?: EngineConfig,
  ) => {
    const objective =
      operation === 'min' || operation === 'max' ? { direction: operation, path } : undefined
    const result = await collect(options, ctx, engineConfig, objective)
    const values = queryNumberValues(result, path)
    if (operation === 'sum') return values.reduce((sum, value) => sum + value, 0)
    if (values.length === 0) return null
    if (operation === 'mean') {
      return values.reduce((sum, value) => sum + value, 0) / values.length
    }
    return operation === 'min' ? Math.min(...values) : Math.max(...values)
  }

  const select = async (
    path: string,
    direction: 'min' | 'max',
    options?: DagQueryExecutionOptions,
    ctx?: NodeContext,
    engineConfig?: EngineConfig,
  ) => {
    const result = await collect(options, ctx, engineConfig, { direction, path })
    return querySelection(result, path, direction)
  }

  return {
    collect,
    min: async (path, options, ctx, engineConfig) =>
      await aggregate(path, 'min', options, ctx, engineConfig),
    max: async (path, options, ctx, engineConfig) =>
      await aggregate(path, 'max', options, ctx, engineConfig),
    argmin: async (path, options, ctx, engineConfig) =>
      await select(path, 'min', options, ctx, engineConfig),
    argmax: async (path, options, ctx, engineConfig) =>
      await select(path, 'max', options, ctx, engineConfig),
    mean: async (path, options, ctx, engineConfig) =>
      await aggregate(path, 'mean', options, ctx, engineConfig),
    sum: async (path, options, ctx, engineConfig) =>
      (await aggregate(path, 'sum', options, ctx, engineConfig)) ?? 0,
    map: async <TargetParams, TargetOutput>(
      target: DagInputAccessor<TargetParams, TargetOutput>,
      bindings: Record<string, DagQueryBinding>,
      options?: DagQueryExecutionOptions,
      ctx?: NodeContext,
      engineConfig?: EngineConfig,
    ) => {
      const source = await collect(options, ctx, engineConfig)
      const rows = await Promise.all(
        source.rows.map(async (row, index) => {
          const params = resolveQueryBindings(bindings, {
            row,
            rows: source.rows,
            ...(source.rowKeys[index] === undefined ? {} : { rowKey: source.rowKeys[index] }),
          })
          return await target(params as TargetParams, ctx ? { ctx } : undefined)
        }),
      )
      return {
        ...source,
        rows,
        best: source.bestIndex === null ? null : rows[source.bestIndex]!,
      }
    },
    apply: async <TargetParams, TargetOutput>(
      target: DagInputAccessor<TargetParams, TargetOutput>,
      bindings: Record<string, DagQueryBinding>,
      options?: DagQueryExecutionOptions,
      ctx?: NodeContext,
      engineConfig?: EngineConfig,
    ) => {
      const source = await collect(options, ctx, engineConfig)
      const params = resolveQueryBindings(bindings, { rows: source.rows })
      return await target(params as TargetParams, ctx ? { ctx } : undefined)
    },
  }
}

export const createDagNodeAccessor = <P, O>(
  node: DagNode<P, O>,
  ctx?: NodeContext,
  engineConfig?: EngineConfig,
): DagInputAccessor<P, O> => {
  const run = async (params?: P, opts?: { ctx?: NodeContext }) =>
    (await node.call((params ?? {}) as P).run(opts?.ctx ?? ctx, engineConfig)).value
  const accessor = run as DagInputAccessor<P, O>
  Object.defineProperty(accessor, 'alias', {
    enumerable: true,
    value: node.localName ?? node.name,
  })
  accessor.slice = (sliceParams) =>
    createDagSliceQuery({
      node,
      baseParams: {},
      sliceParams,
      ...(ctx ? { defaultCtx: ctx } : {}),
      ...(engineConfig ? { defaultEngineConfig: engineConfig } : {}),
    })
  return accessor
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
  description?: string
  contentHash?: Hash
  version: number
  effect?: DagNodeEffect

  hiddenInputs?: HiddenInputs
  exposedInputs?: ExposedInputs
  localParams?: LocalParamsSchema

  outputSchema: OSchema
  policy?: NodePolicy

  run: (
    params: P,
    helpers: {
      [K in keyof ExposedInputs]: DagInputAccessor<
        ParamsOfInput<ExposedInputs[K]>,
        OutputOfInput<ExposedInputs[K]>
      >
    } & {
      [K in keyof HiddenInputs]: DagInputAccessor<
        ParamsOf<HiddenInputs[K]>,
        OutputOf<HiddenInputs[K]>
      >
    },
    ctx?: NodeContext,
  ) => Promise<O> | O
}) {
  const {
    name,
    localName,
    description,
    contentHash,
    version,
    effect = 'pure',
    exposedInputs,
    hiddenInputs,
    localParams,
    outputSchema,
    policy,
    run,
  } = args

  assertDagNodeEffectSource(effect, run.toString())

  const paramsSchema = combinedParams(
    localParams ?? emptyObjectSchema,
    exposedInputs ? schemaFromInputs(exposedInputs) : emptyObjectSchema,
  )

  const defaultPolicy: NodePolicy = policy ?? {
    cache: 'ReadWrite',
    scope: effect === 'source' ? 'Environment' : 'Debug',
  }

  defaultPolicyRegistry[name] = defaultPolicy

  // The node methods close over the final node object for recursive execution paths.
  // eslint-disable-next-line prefer-const
  let node!: DagNode<P, O>
  const nodeImpl: DagNode<P, O> = {
    name,
    ...(localName ? { localName } : {}),
    ...(description ? { description } : {}),
    ...(contentHash ? { contentHash } : {}),
    version,
    effect,
    paramsSchema,
    outputSchema,
    defaultPolicy,
    hiddenInputs,
    exposedInputs,

    _runImpl: (params: unknown, helpers: unknown, ctx?: NodeContext) =>
      run(
        params as P,
        helpers as {
          [K in keyof ExposedInputs]: DagInputAccessor<
            ParamsOfInput<ExposedInputs[K]>,
            OutputOfInput<ExposedInputs[K]>
          >
        } & {
          [K in keyof HiddenInputs]: DagInputAccessor<
            ParamsOf<HiddenInputs[K]>,
            OutputOf<HiddenInputs[K]>
          >
        },
        ctx,
      ),

    call: (paramsValue: P) => ({
      node,
      params: paramsValue,
      slice: (sliceParams) =>
        createDagSliceQuery({
          baseParams: paramsValue as Record<string, unknown>,
          node,
          sliceParams,
        }),
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
          const paramsHash = executionParamsHash(validatedParams as Record<string, unknown>)
          const nodeCodeHash = getNodeCodeHash(node)
          const key = makeNodeKey(paramsHash, nodeCodeHash)
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
        const variableRunCount = variableDims.reduce(
          (count, dimension) => count * dimension.values.length,
          1,
        )
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

        const plan = opts?.plan ?? buildStudyPlanFromResolved(resolved, opts, variableRunCount)
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
        const collectRows = opts?.collectRows !== false
        const collectHistory = opts?.collectHistory !== false
        const byAlias = new Map(resolved.map((e) => [e.alias, e]))
        const startMs = Date.now()
        const maxRows = opts?.budget?.maxRows
        const maxEvals = opts?.budget?.maxEvals
        const timeMs = opts?.budget?.timeMs

        let bestIndex: number | null = null
        let best: O | null = null
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
          if (maxRows !== undefined && completedEvals >= maxRows) return 'maxRows' as const
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
          const rowIndex = completedEvals
          completedEvals += 1
          if (collectRows) {
            rows.push(result.value)
            rowKeys.push(keyRow)
          }
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
              bestIndex = rowIndex
              best = result.value
              bestObjectiveValue = objectiveValue
            } else {
              const better =
                objective.direction === 'max'
                  ? objectiveValue > (bestObjectiveValue as number)
                  : objectiveValue < (bestObjectiveValue as number)
              if (better) {
                bestIndex = rowIndex
                best = result.value
                bestObjectiveValue = objectiveValue
              }
            }
          }

          if (collectHistory) {
            history.push({
              rowIndex,
              row: result.value,
              rowKey: keyRow,
              sourceIndexByAlias,
              objectiveValue,
              ...(captured ? { captured } : {}),
            })
          }

          await opts?.onRow?.({
            rowIndex,
            row: result.value,
            rowKey: keyRow,
            sourceIndexByAlias,
            objectiveValue,
            ...(captured ? { captured } : {}),
          })
          await maybeYieldToUi()
        }

        for (const patch of iterateCombinations(variableDims)) {
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

          for (const combo of iterateExplodedCombinations(resolved)) {
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
          best,
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
  const paramsHash = executionParamsHash(validatedParams)
  const nodeCodeHash = getNodeCodeHash(node)
  const key = makeNodeKey(paramsHash, nodeCodeHash)

  const policy = engineConfig.nodePolicies?.[node.name] ?? node.defaultPolicy
  const sourceExecution = node.effect === 'source' ? engineConfig.sourceExecution : undefined
  const acquisitionKey = sourceExecution
    ? canonicalHash({ kind: 'taskyon.sourceAcquisition.v1', nodeHash: nodeCodeHash, paramsHash })
    : undefined

  if (sourceExecution && acquisitionKey) {
    const pinnedId = sourceExecution.projectId
      ? await sourceExecution.repository.getProjectPin(
          sourceExecution.projectId,
          node.name,
          acquisitionKey,
        )
      : null
    const manifestId = pinnedId ?? (await sourceExecution.repository.getCurrent(acquisitionKey))
    const manifest = manifestId ? await sourceExecution.repository.getManifest(manifestId) : null
    const refresh = shouldRefreshSource({
      policy: sourceExecution.nodePolicies?.[node.name] ?? sourceExecution.defaultPolicy,
      manifest,
      nowMs: ctx.nowUtcMs,
      force:
        sourceExecution.forceNodeNames?.has(node.name) === true &&
        !sourceExecution.refreshedAcquisitionKeys.has(acquisitionKey),
      refreshedInRun: sourceExecution.refreshedAcquisitionKeys.has(acquisitionKey),
    })
    if (!refresh && manifest) {
      const value = await backend.readArtifact(manifest.artifactHash)
      ctx.log('DAG source loaded from manifest', dagExecutionLogData(node, 'cached'))
      return { value, artifactHash: manifest.artifactHash }
    }
  }

  if (!sourceExecution && (policy.cache === 'ReadOnly' || policy.cache === 'ReadWrite')) {
    const cached = await backend.getCacheEntry(key)
    if (cached) {
      const value = await backend.readArtifact(cached.artifact)
      ctx.log('DAG node loaded from cache', dagExecutionLogData(node, 'cached'))
      return { value, artifactHash: cached.artifact }
    }
  }

  const childEngineConfig = bindExposedInputParams(node, validatedParams, engineConfig)
  const addInputs = (
    inputs: Record<string, DagNode> | Record<string, ExposedInputDef> | undefined,
    expose: boolean,
  ) => {
    const use: Record<string, DagInputAccessor> = {}
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

  ctx.log('DAG node started', dagExecutionLogData(node, 'running'))
  let value: unknown
  let artifactHash: Hash
  try {
    const rawValue = await Promise.resolve(node._runImpl(validatedParams, use, ctx))
    value = parseSchema(node.outputSchema, rawValue)
    artifactHash = await backend.writeArtifact(value)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    ctx.log('DAG node failed', dagExecutionLogData(node, 'failed', message))
    throw error
  }

  if (policy.cache === 'WriteOnly' || policy.cache === 'ReadWrite') {
    await backend.setCacheEntry(key, { artifact: artifactHash })
  }

  if (sourceExecution && acquisitionKey) {
    const manifest = createSourceLockManifest({
      nodeHash: nodeCodeHash,
      acquisitionKey,
      paramsHash,
      artifactHash,
      createdAtMs: ctx.nowUtcMs,
    })
    await sourceExecution.repository.putManifest(manifest)
    await sourceExecution.repository.setCurrent(acquisitionKey, manifest.id)
    if (sourceExecution.projectId) {
      await sourceExecution.repository.setProjectPin(
        sourceExecution.projectId,
        node.name,
        acquisitionKey,
        manifest.id,
      )
    }
    sourceExecution.refreshedAcquisitionKeys.add(acquisitionKey)
  }

  ctx.log('DAG node completed', dagExecutionLogData(node, 'completed'))

  return { value, artifactHash }
}

const resolveInputExecution = (args: {
  expose: boolean
  node: DagNode
  alias: string
  validatedParams: Record<string, unknown>
  inputDef: ExposedInputDef
  maybeParams?: Record<string, unknown>
  allowPartial?: boolean
  engineConfig: EngineConfig
}): { childNode: DagNode; childParams: Record<string, unknown> } => {
  const providerRaw =
    args.maybeParams?.__provider ?? args.validatedParams?.[`${args.alias}__provider`]
  const providerOverride =
    typeof providerRaw === 'string' || typeof providerRaw === 'number' ? providerRaw : undefined
  const parentAliasRaw = args.validatedParams[args.alias]
  const parentAliasParams =
    typeof parentAliasRaw === 'object' && parentAliasRaw !== null
      ? (parentAliasRaw as Record<string, unknown>)
      : {}

  let childParams: Record<string, unknown>
  if (args.maybeParams !== undefined) {
    childParams = args.expose
      ? { ...parentAliasParams, ...args.maybeParams }
      : { ...args.maybeParams }
    delete childParams.__provider
  } else if (!args.expose) {
    if (!args.allowPartial) {
      throw new Error(
        `Node ${args.node.name}: use.${args.alias}() called without params, but this input is internal and does not expose parent params. Please provide params explicitly when calling use.${args.alias}().`,
      )
    }
    childParams = {}
  } else {
    childParams = { ...parentAliasParams }
  }

  const childNode = selectInputNodeByParams(args.inputDef, providerOverride, [
    childParams,
    parentAliasParams,
    args.validatedParams,
    {},
  ])
  if (!childNode) {
    throw new Error(`Node ${args.node.name}: no provider resolved for input alias "${args.alias}".`)
  }

  return {
    childNode,
    childParams: {
      ...(args.engineConfig.parameterBindings?.[childNode.name] ?? {}),
      ...childParams,
    },
  }
}

const createExecutionWithChecks = (
  expose: boolean,
  node: DagNode,
  alias: string,
  validatedParams: Record<string, unknown>,
  inputDef: ExposedInputDef,
  ctx: NodeContext,
  engineConfig: EngineConfig,
): DagInputAccessor => {
  const run = async (maybeParams?: Record<string, unknown>, opts?: { ctx?: NodeContext }) => {
    const resolved = resolveInputExecution({
      expose,
      node,
      alias,
      validatedParams,
      inputDef,
      ...(maybeParams === undefined ? {} : { maybeParams }),
      engineConfig,
    })
    const { value } = await executeNode(
      resolved.childNode,
      resolved.childParams,
      opts?.ctx ?? ctx,
      engineConfig,
    )
    return value
  }

  const accessor = run as DagInputAccessor
  Object.defineProperty(accessor, 'alias', { enumerable: true, value: alias })
  accessor.slice = (sliceParams) => {
    const resolved = resolveInputExecution({
      expose,
      node,
      alias,
      validatedParams,
      inputDef,
      allowPartial: true,
      engineConfig,
    })
    return createDagSliceQuery({
      node: resolved.childNode,
      baseParams: resolved.childParams,
      sliceParams,
      defaultCtx: ctx,
      defaultEngineConfig: engineConfig,
    })
  }
  return accessor
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

const executionParamsHash = (params: Record<string, unknown>): Hash => canonicalHash(params)
