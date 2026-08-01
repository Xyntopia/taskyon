import { canonicalHash, type Hash } from './caching.ts'
import { getDefaultInMemoryBackend } from './caching.ts'
import {
  createDagNodeAccessor,
  type DagNode,
  type DagQueryBinding,
  type DagQueryExecutionOptions,
  type DagSliceParams,
  type EngineConfig,
  type NodeContext,
  type StudyBudget,
} from './dagCore.ts'

export type DagInvocationOperation =
  | { kind: 'collect' }
  | { kind: 'min' | 'max' | 'argmin' | 'argmax' | 'mean' | 'sum'; path: string }
  | {
      kind: 'map' | 'apply'
      targetNodeId: Hash
      bindings: Record<string, DagQueryBinding>
    }

export type DagInvocationRecord = {
  schemaVersion: 1
  id: Hash
  localName: string
  nodeId: Hash
  slice: DagSliceParams
  operation: DagInvocationOperation
}

export type DagResolvedStrategy = {
  id: string
  version: number
  configuration?: Record<string, unknown>
}

export type DagEvaluationPolicy = {
  engine: { id: string; version: number }
  mode: 'exact' | 'approximate'
  resolvedStrategies: Record<string, DagResolvedStrategy>
  parallelism: number
  seed?: number
  budget?: StudyBudget
  stopping?: Record<string, unknown>
}

export type DagEvaluationRecord = {
  schemaVersion: 1
  id: Hash
  invocationId: Hash
  policy: DagEvaluationPolicy
  startedAtMs: number
  completedAtMs?: number
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  progress?: { completed: number; total?: number }
  resultArtifactIds: Hash[]
  error?: string
}

const requireObject = (value: unknown, label: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`)
  }
  return value as Record<string, unknown>
}

const requireHash = (value: unknown, label: string): Hash => {
  if (typeof value !== 'string' || !/^sha256:[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`${label} must be a canonical sha256 hash.`)
  }
  return value as Hash
}

const requireString = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} is required.`)
  return value
}

const invocationIdentity = (
  record: Pick<DagInvocationRecord, 'nodeId' | 'slice' | 'operation'>,
) => ({
  kind: 'taskyon.dagInvocation.v1',
  nodeId: record.nodeId,
  slice: record.slice,
  operation: record.operation,
})

export const defineDagInvocation = (
  input: Omit<DagInvocationRecord, 'id' | 'schemaVersion'>,
): DagInvocationRecord => ({
  schemaVersion: 1,
  id: canonicalHash(invocationIdentity(input)),
  localName: input.localName,
  nodeId: input.nodeId,
  slice: input.slice,
  operation: input.operation,
})

const parseBinding = (value: unknown, label: string): DagQueryBinding => {
  const binding = requireObject(value, label)
  if (binding.source === 'rows') return { source: 'rows' }
  if (binding.source === 'value') return { source: 'value', value: binding.value }
  if (binding.source === 'row' || binding.source === 'rowKey') {
    if (binding.path !== undefined && typeof binding.path !== 'string') {
      throw new Error(`${label}.path must be a string.`)
    }
    return {
      source: binding.source,
      ...(typeof binding.path === 'string' ? { path: binding.path } : {}),
    }
  }
  throw new Error(`${label}.source is invalid.`)
}

const parseOperation = (value: unknown): DagInvocationOperation => {
  const operation = requireObject(value, 'Invocation operation')
  if (operation.kind === 'collect') return { kind: 'collect' }
  if (
    operation.kind === 'min' ||
    operation.kind === 'max' ||
    operation.kind === 'argmin' ||
    operation.kind === 'argmax' ||
    operation.kind === 'mean' ||
    operation.kind === 'sum'
  ) {
    return { kind: operation.kind, path: requireString(operation.path, 'Invocation result path') }
  }
  if (operation.kind === 'map' || operation.kind === 'apply') {
    const bindings = requireObject(operation.bindings, 'Invocation bindings')
    return {
      kind: operation.kind,
      targetNodeId: requireHash(operation.targetNodeId, 'Invocation target node id'),
      bindings: Object.fromEntries(
        Object.entries(bindings).map(([path, binding]) => [
          path,
          parseBinding(binding, `Invocation binding ${path}`),
        ]),
      ),
    }
  }
  throw new Error('Invocation operation kind is invalid.')
}

export const parseDagInvocation = (value: unknown): DagInvocationRecord => {
  const input = requireObject(value, 'DAG invocation')
  if (input.schemaVersion !== 1) throw new Error('Unsupported DAG invocation version.')
  const record = defineDagInvocation({
    localName: requireString(input.localName, 'Invocation local name'),
    nodeId: requireHash(input.nodeId, 'Invocation node id'),
    operation: parseOperation(input.operation),
    slice: requireObject(input.slice, 'Invocation slice'),
  })
  if (requireHash(input.id, 'Invocation id') !== record.id) {
    throw new Error('DAG invocation hash does not match its semantic content.')
  }
  return record
}

const evaluationIdentity = (record: Omit<DagEvaluationRecord, 'id'>) => ({
  kind: 'taskyon.dagEvaluation.v1',
  ...record,
})

export const createDagEvaluationRecord = (
  input: Omit<DagEvaluationRecord, 'id' | 'schemaVersion'>,
): DagEvaluationRecord => {
  const record: Omit<DagEvaluationRecord, 'id'> = {
    schemaVersion: 1,
    invocationId: input.invocationId,
    policy: input.policy,
    startedAtMs: input.startedAtMs,
    ...(input.completedAtMs === undefined ? {} : { completedAtMs: input.completedAtMs }),
    status: input.status,
    ...(input.progress ? { progress: input.progress } : {}),
    resultArtifactIds: [...input.resultArtifactIds],
    ...(input.error ? { error: input.error } : {}),
  }
  return { ...record, id: canonicalHash(evaluationIdentity(record)) }
}

const parseStrategy = (value: unknown, label: string): DagResolvedStrategy => {
  const strategy = requireObject(value, label)
  if (typeof strategy.version !== 'number' || !Number.isInteger(strategy.version)) {
    throw new Error(`${label}.version must be an integer.`)
  }
  return {
    id: requireString(strategy.id, `${label}.id`),
    version: strategy.version,
    ...(strategy.configuration === undefined
      ? {}
      : { configuration: requireObject(strategy.configuration, `${label}.configuration`) }),
  }
}

const parseEvaluationPolicy = (value: unknown): DagEvaluationPolicy => {
  const policy = requireObject(value, 'Evaluation policy')
  const engine = requireObject(policy.engine, 'Evaluation engine')
  const strategies = requireObject(policy.resolvedStrategies, 'Evaluation strategies')
  if (policy.mode !== 'exact' && policy.mode !== 'approximate') {
    throw new Error('Evaluation policy mode is invalid.')
  }
  if (typeof policy.parallelism !== 'number' || !Number.isInteger(policy.parallelism)) {
    throw new Error('Evaluation parallelism must be an integer.')
  }
  return {
    engine: {
      id: requireString(engine.id, 'Evaluation engine id'),
      version: Number(engine.version),
    },
    mode: policy.mode,
    resolvedStrategies: Object.fromEntries(
      Object.entries(strategies).map(([path, strategy]) => [
        path,
        parseStrategy(strategy, `Evaluation strategy ${path}`),
      ]),
    ),
    parallelism: policy.parallelism,
    ...(typeof policy.seed === 'number' ? { seed: policy.seed } : {}),
    ...(policy.budget === undefined
      ? {}
      : { budget: requireObject(policy.budget, 'Evaluation budget') as StudyBudget }),
    ...(policy.stopping === undefined
      ? {}
      : { stopping: requireObject(policy.stopping, 'Evaluation stopping policy') }),
  }
}

export const parseDagEvaluationRecord = (value: unknown): DagEvaluationRecord => {
  const input = requireObject(value, 'DAG evaluation')
  if (input.schemaVersion !== 1) throw new Error('Unsupported DAG evaluation version.')
  if (
    input.status !== 'running' &&
    input.status !== 'completed' &&
    input.status !== 'failed' &&
    input.status !== 'cancelled'
  ) {
    throw new Error('DAG evaluation status is invalid.')
  }
  if (!Array.isArray(input.resultArtifactIds)) {
    throw new Error('DAG evaluation result artifacts must be an array.')
  }
  const progress =
    input.progress === undefined
      ? undefined
      : requireObject(input.progress, 'DAG evaluation progress')
  const record = createDagEvaluationRecord({
    invocationId: requireHash(input.invocationId, 'Evaluation invocation id'),
    policy: parseEvaluationPolicy(input.policy),
    startedAtMs: Number(input.startedAtMs),
    ...(input.completedAtMs === undefined ? {} : { completedAtMs: Number(input.completedAtMs) }),
    status: input.status,
    ...(progress
      ? {
          progress: {
            completed: Number(progress.completed),
            ...(progress.total === undefined ? {} : { total: Number(progress.total) }),
          },
        }
      : {}),
    resultArtifactIds: input.resultArtifactIds.map((id, index) =>
      requireHash(id, `Evaluation result artifact ${index}`),
    ),
    ...(typeof input.error === 'string' ? { error: input.error } : {}),
  })
  if (requireHash(input.id, 'Evaluation id') !== record.id) {
    throw new Error('DAG evaluation hash does not match its content.')
  }
  return record
}

const resolveInvocationNode = (
  id: Hash,
  resolveNode: (id: Hash) => DagNode | undefined,
): DagNode => {
  const node = resolveNode(id)
  if (!node) throw new Error(`DAG invocation references missing node ${id}.`)
  if (node.contentHash !== id) {
    throw new Error(
      `DAG invocation requires exact node hash ${id}; resolver returned ${node.name}.`,
    )
  }
  return node
}

export const executeDagInvocation = async (args: {
  invocation: DagInvocationRecord
  resolveNode: (id: Hash) => DagNode | undefined
  ctx?: NodeContext
  engineConfig?: EngineConfig
  options?: DagQueryExecutionOptions
}): Promise<unknown> => {
  const source = createDagNodeAccessor(
    resolveInvocationNode(args.invocation.nodeId, args.resolveNode),
    args.ctx,
    args.engineConfig,
  )
  const query = source.slice(args.invocation.slice)
  const operation = args.invocation.operation
  switch (operation.kind) {
    case 'collect':
      return await query.collect(args.options)
    case 'min':
    case 'max':
    case 'argmin':
    case 'argmax':
    case 'mean':
    case 'sum':
      return await query[operation.kind](operation.path, args.options)
    case 'map':
    case 'apply': {
      const target = createDagNodeAccessor(
        resolveInvocationNode(operation.targetNodeId, args.resolveNode),
        args.ctx,
        args.engineConfig,
      )
      return operation.kind === 'map'
        ? await query.map(target, operation.bindings, args.options)
        : await query.apply(target, operation.bindings, args.options)
    }
  }
}

export const dagEvaluationCacheKey = (invocationId: Hash, policy: DagEvaluationPolicy): Hash =>
  canonicalHash({
    kind: 'taskyon.dagEvaluationCache.v1',
    invocationId,
    policy,
  })

export const evaluateDagInvocation = async (args: {
  invocation: DagInvocationRecord
  policy: DagEvaluationPolicy
  resolveNode: (id: Hash) => DagNode | undefined
  ctx?: NodeContext
  engineConfig?: EngineConfig
  now?: () => number
}): Promise<{ value: unknown; evaluation: DagEvaluationRecord; cacheHit: boolean }> => {
  const now = args.now ?? Date.now
  const startedAtMs = now()
  const storageBackend = args.engineConfig?.storageBackend ?? getDefaultInMemoryBackend()
  const key = dagEvaluationCacheKey(args.invocation.id, args.policy)
  const cached = await storageBackend.getCacheEntry(key)
  const options: DagQueryExecutionOptions = {
    ...(args.policy.budget ? { budget: args.policy.budget } : {}),
    ...(args.policy.seed === undefined ? {} : { rngSeed: args.policy.seed }),
  }
  const value = cached
    ? await storageBackend.readArtifact(cached.artifact)
    : await executeDagInvocation({
        invocation: args.invocation,
        resolveNode: args.resolveNode,
        ...(args.ctx ? { ctx: args.ctx } : {}),
        ...(args.engineConfig ? { engineConfig: args.engineConfig } : {}),
        options,
      })
  const artifactId = cached?.artifact ?? (await storageBackend.writeArtifact(value))
  if (!cached) await storageBackend.setCacheEntry(key, { artifact: artifactId })
  const evaluation = createDagEvaluationRecord({
    invocationId: args.invocation.id,
    policy: args.policy,
    startedAtMs,
    completedAtMs: now(),
    status: 'completed',
    resultArtifactIds: [artifactId],
  })
  return { value, evaluation, cacheHit: cached !== null }
}
