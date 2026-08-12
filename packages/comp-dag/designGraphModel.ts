import { canonicalHash, type Hash } from './caching.ts'
import {
  objectiveSchema,
  optimizationCaptureSpecSchema,
  optimizationInputSpecSchema,
  variableSpecSchema,
  type Objective,
  type OptimizationCaptureSpec,
  type OptimizationInputSpec,
  type VariableSpec,
} from './optimization.ts'

export type GraphRevision = {
  schemaVersion: 2
  id: Hash
  parents: Hash[]
  nodes: Record<string, Hash>
}

export type InvocationConstraint = {
  path: string
  operator: '<=' | '>=' | '=='
  limit: string | number | boolean
}

export type ReducerAccuracy = 'auto' | 'exact' | 'approximate'

export type InvocationRequestedPolicy = {
  accuracy: ReducerAccuracy
  optimizer?: { id: string; version: number; configuration?: Record<string, unknown> }
  estimator?: { id: string; version: number; configuration?: Record<string, unknown> }
  seed?: number
  tolerance?: number
  stopping?: Record<string, unknown>
  budget?: { maxRows?: number; maxEvals?: number; timeMs?: number }
}

export type InvocationDefinition = {
  schemaVersion: 2
  id: Hash
  rootNodeId: Hash
  variables: Record<string, VariableSpec>
  inputs: Record<string, OptimizationInputSpec>
  objectives: Objective[]
  constraints: InvocationConstraint[]
  capture: OptimizationCaptureSpec[]
  policy: InvocationRequestedPolicy
  reducerOverrides: Record<string, ReducerAccuracy>
}

export type InvocationCategory = 'design' | 'exploration' | 'optimization'

export type ProjectRevision = {
  schemaVersion: 2
  id: Hash
  parents: Hash[]
  displayName: string
  invocations: Record<string, Hash>
  extensions: Record<string, Hash>
}

export type ProjectExtension = {
  schemaVersion: 2
  id: Hash
  namespace: string
  value: unknown
}

export type DesignGraphRef = {
  schemaVersion: 2
  revisionId: Hash
}

export type ResolvedInvocationPolicy = {
  engine: { id: string; version: number }
  accuracy: 'exact' | 'approximate'
  strategies: Record<
    string,
    { id: string; version: number; configuration?: Record<string, unknown> }
  >
  seed?: number
  tolerance?: number
  stopping?: Record<string, unknown>
}

export type InvocationArtifact = {
  id: Hash
  mediaType?: string
  size?: number
}

export type InvocationRun = {
  schemaVersion: 2
  id: Hash
  invocationId: Hash
  resolvedPolicy: ResolvedInvocationPolicy
  status: 'completed' | 'failed' | 'cancelled'
  startedAtMs: number
  completedAtMs: number
  artifacts: Record<string, InvocationArtifact>
  provenance: Record<string, unknown>
  error?: string
}

export type ExecutionAttempt = {
  schemaVersion: 2
  attemptId: string
  invocationId: Hash
  status: 'queued' | 'running' | 'cancelling' | 'finalizing'
  completedRows: number
  totalRows?: number
  checkpointArtifactId?: Hash
  startedAtMs: number
  updatedAtMs: number
}

export type DagEngineSettings = {
  schemaVersion: 1
  workerCount?: number
  concurrency?: number
  executionLocation?: string
  progressCadenceMs?: number
  checkpointCadenceMs?: number
  memoryLimitBytes?: number
  artifactRetentionBytes?: number
}

const hashPattern = /^sha256:[A-Za-z0-9_-]{43}$/

const objectAtBoundary = (value: unknown, label: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`)
  }
  return value as Record<string, unknown>
}

const hashAtBoundary = (value: unknown, label: string): Hash => {
  if (typeof value !== 'string' || !hashPattern.test(value)) {
    throw new Error(`${label} must be a canonical sha256 hash.`)
  }
  return value as Hash
}

const stringAtBoundary = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`)
  }
  return value
}

const integerAtBoundary = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`${label} must be an integer.`)
  }
  return value
}

const numberAtBoundary = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`)
  }
  return value
}

const hashMapAtBoundary = (value: unknown, label: string): Record<string, Hash> =>
  Object.fromEntries(
    Object.entries(objectAtBoundary(value, label)).map(([name, id]) => [
      stringAtBoundary(name, `${label} name`),
      hashAtBoundary(id, `${label}.${name}`),
    ]),
  )

const hashIdentity = <T extends object>(kind: string, value: T): Hash =>
  canonicalHash({ kind, ...value })

const assertIdentity = (actual: unknown, expected: Hash, label: string) => {
  if (hashAtBoundary(actual, `${label} id`) !== expected) {
    throw new Error(`${label} hash does not match its semantic content.`)
  }
}

export const createGraphRevision = (
  input: Omit<GraphRevision, 'schemaVersion' | 'id'>,
): GraphRevision => {
  const value = { schemaVersion: 2 as const, parents: [...input.parents], nodes: input.nodes }
  return { ...value, id: hashIdentity('taskyon.graphRevision.v2', value) }
}

export const parseGraphRevision = (value: unknown): GraphRevision => {
  const input = objectAtBoundary(value, 'Graph revision')
  if (input.schemaVersion !== 2 || !Array.isArray(input.parents)) {
    throw new Error('Unsupported graph revision.')
  }
  const record = createGraphRevision({
    parents: input.parents.map((parent, index) =>
      hashAtBoundary(parent, `Graph revision parent ${index}`),
    ),
    nodes: hashMapAtBoundary(input.nodes, 'Graph revision nodes'),
  })
  assertIdentity(input.id, record.id, 'Graph revision')
  return record
}

const parseConstraint = (value: unknown, index: number): InvocationConstraint => {
  const input = objectAtBoundary(value, `Invocation constraint ${index}`)
  if (input.operator !== '<=' && input.operator !== '>=' && input.operator !== '==') {
    throw new Error(`Invocation constraint ${index} operator is invalid.`)
  }
  if (
    typeof input.limit !== 'string' &&
    typeof input.limit !== 'number' &&
    typeof input.limit !== 'boolean'
  ) {
    throw new Error(`Invocation constraint ${index} limit is invalid.`)
  }
  return {
    path: stringAtBoundary(input.path, `Invocation constraint ${index} path`),
    operator: input.operator,
    limit: input.limit,
  }
}

const parseRequestedStrategy = (
  value: unknown,
  label: string,
): NonNullable<InvocationRequestedPolicy['optimizer']> => {
  const input = objectAtBoundary(value, label)
  return {
    id: stringAtBoundary(input.id, `${label} id`),
    version: integerAtBoundary(input.version, `${label} version`),
    ...(input.configuration === undefined
      ? {}
      : { configuration: objectAtBoundary(input.configuration, `${label} configuration`) }),
  }
}

const parseRequestedPolicy = (value: unknown): InvocationRequestedPolicy => {
  const input = objectAtBoundary(value, 'Invocation policy')
  if (input.accuracy !== 'auto' && input.accuracy !== 'exact' && input.accuracy !== 'approximate') {
    throw new Error('Invocation policy accuracy is invalid.')
  }
  const budget =
    input.budget === undefined ? undefined : objectAtBoundary(input.budget, 'Invocation budget')
  return {
    accuracy: input.accuracy,
    ...(input.optimizer === undefined
      ? {}
      : { optimizer: parseRequestedStrategy(input.optimizer, 'Invocation optimizer') }),
    ...(input.estimator === undefined
      ? {}
      : { estimator: parseRequestedStrategy(input.estimator, 'Invocation estimator') }),
    ...(input.seed === undefined ? {} : { seed: integerAtBoundary(input.seed, 'Invocation seed') }),
    ...(input.tolerance === undefined
      ? {}
      : { tolerance: numberAtBoundary(input.tolerance, 'Invocation tolerance') }),
    ...(input.stopping === undefined
      ? {}
      : { stopping: objectAtBoundary(input.stopping, 'Invocation stopping policy') }),
    ...(budget === undefined
      ? {}
      : {
          budget: {
            ...(budget.maxRows === undefined
              ? {}
              : { maxRows: integerAtBoundary(budget.maxRows, 'Invocation max rows') }),
            ...(budget.maxEvals === undefined
              ? {}
              : { maxEvals: integerAtBoundary(budget.maxEvals, 'Invocation max evaluations') }),
            ...(budget.timeMs === undefined
              ? {}
              : { timeMs: integerAtBoundary(budget.timeMs, 'Invocation time budget') }),
          },
        }),
  }
}

const parseReducerOverrides = (value: unknown): Record<string, ReducerAccuracy> =>
  Object.fromEntries(
    Object.entries(objectAtBoundary(value, 'Invocation reducer overrides')).map(
      ([address, accuracy]) => {
        if (accuracy !== 'auto' && accuracy !== 'exact' && accuracy !== 'approximate') {
          throw new Error(`Reducer override ${address} is invalid.`)
        }
        return [address, accuracy]
      },
    ),
  )

export const createInvocationDefinition = (
  input: Omit<InvocationDefinition, 'schemaVersion' | 'id' | 'inputs' | 'capture'> & {
    inputs?: Record<string, OptimizationInputSpec>
    capture?: OptimizationCaptureSpec[]
  },
): InvocationDefinition => {
  const value = {
    schemaVersion: 2 as const,
    rootNodeId: input.rootNodeId,
    variables: input.variables,
    inputs: input.inputs ?? {},
    objectives: [...input.objectives],
    constraints: [...input.constraints],
    capture: [...(input.capture ?? [])],
    policy: input.policy,
    reducerOverrides: input.reducerOverrides,
  }
  return { ...value, id: hashIdentity('taskyon.invocation.v2', value) }
}

export const parseInvocationDefinition = (value: unknown): InvocationDefinition => {
  const input = objectAtBoundary(value, 'Invocation definition')
  if (
    input.schemaVersion !== 2 ||
    !Array.isArray(input.objectives) ||
    !Array.isArray(input.constraints)
  ) {
    throw new Error('Unsupported invocation definition.')
  }
  const variables = Object.fromEntries(
    Object.entries(objectAtBoundary(input.variables, 'Invocation variables')).map(
      ([path, spec]) => [path, variableSpecSchema.parse(spec)],
    ),
  )
  const inputs = Object.fromEntries(
    Object.entries(objectAtBoundary(input.inputs, 'Invocation inputs')).map(([alias, spec]) => [
      alias,
      optimizationInputSpecSchema.parse(spec),
    ]),
  )
  const capture = Array.isArray(input.capture)
    ? input.capture.map((spec) => optimizationCaptureSpecSchema.parse(spec))
    : []
  const record = createInvocationDefinition({
    rootNodeId: hashAtBoundary(input.rootNodeId, 'Invocation root node id'),
    variables,
    inputs,
    objectives: input.objectives.map((objective) => objectiveSchema.parse(objective)),
    constraints: input.constraints.map(parseConstraint),
    capture,
    policy: parseRequestedPolicy(input.policy),
    reducerOverrides: parseReducerOverrides(input.reducerOverrides),
  })
  assertIdentity(input.id, record.id, 'Invocation definition')
  return record
}

export const deriveInvocationCategory = (
  invocation: Pick<InvocationDefinition, 'variables' | 'objectives'>,
): InvocationCategory => {
  if (invocation.objectives.length > 0) return 'optimization'
  return Object.values(invocation.variables).some((variable) => variable.kind !== 'constant')
    ? 'exploration'
    : 'design'
}

export const createProjectRevision = (
  input: Omit<ProjectRevision, 'schemaVersion' | 'id'>,
): ProjectRevision => {
  const value = {
    schemaVersion: 2 as const,
    parents: [...input.parents],
    displayName: input.displayName,
    invocations: input.invocations,
    extensions: input.extensions,
  }
  return { ...value, id: hashIdentity('taskyon.projectRevision.v2', value) }
}

export const parseProjectRevision = (value: unknown): ProjectRevision => {
  const input = objectAtBoundary(value, 'Project revision')
  if (input.schemaVersion !== 2 || !Array.isArray(input.parents)) {
    throw new Error('Unsupported project revision.')
  }
  const record = createProjectRevision({
    parents: input.parents.map((parent, index) =>
      hashAtBoundary(parent, `Project revision parent ${index}`),
    ),
    displayName: stringAtBoundary(input.displayName, 'Project display name'),
    invocations: hashMapAtBoundary(input.invocations, 'Project invocations'),
    extensions: hashMapAtBoundary(input.extensions, 'Project extensions'),
  })
  assertIdentity(input.id, record.id, 'Project revision')
  return record
}

export const createProjectExtension = (
  input: Omit<ProjectExtension, 'schemaVersion' | 'id'>,
): ProjectExtension => {
  const value = { schemaVersion: 2 as const, namespace: input.namespace, value: input.value }
  return { ...value, id: hashIdentity('taskyon.projectExtension.v2', value) }
}

export const parseProjectExtension = (value: unknown): ProjectExtension => {
  const input = objectAtBoundary(value, 'Project extension')
  if (input.schemaVersion !== 2) throw new Error('Unsupported project extension.')
  const record = createProjectExtension({
    namespace: stringAtBoundary(input.namespace, 'Project extension namespace'),
    value: input.value,
  })
  assertIdentity(input.id, record.id, 'Project extension')
  return record
}

export const parseDesignGraphRef = (value: unknown): DesignGraphRef => {
  const input = objectAtBoundary(value, 'Design graph ref')
  if (input.schemaVersion !== 2) throw new Error('Unsupported design graph ref.')
  return { schemaVersion: 2, revisionId: hashAtBoundary(input.revisionId, 'Ref revision id') }
}

const parseResolvedStrategy = (
  value: unknown,
  label: string,
): ResolvedInvocationPolicy['strategies'][string] => parseRequestedStrategy(value, label)

const parseResolvedPolicy = (value: unknown): ResolvedInvocationPolicy => {
  const input = objectAtBoundary(value, 'Resolved invocation policy')
  const engine = objectAtBoundary(input.engine, 'Resolved engine')
  if (input.accuracy !== 'exact' && input.accuracy !== 'approximate') {
    throw new Error('Resolved invocation accuracy is invalid.')
  }
  return {
    engine: {
      id: stringAtBoundary(engine.id, 'Resolved engine id'),
      version: integerAtBoundary(engine.version, 'Resolved engine version'),
    },
    accuracy: input.accuracy,
    strategies: Object.fromEntries(
      Object.entries(objectAtBoundary(input.strategies, 'Resolved strategies')).map(
        ([address, strategy]) => [address, parseResolvedStrategy(strategy, `Strategy ${address}`)],
      ),
    ),
    ...(input.seed === undefined ? {} : { seed: integerAtBoundary(input.seed, 'Resolved seed') }),
    ...(input.tolerance === undefined
      ? {}
      : { tolerance: numberAtBoundary(input.tolerance, 'Resolved tolerance') }),
    ...(input.stopping === undefined
      ? {}
      : { stopping: objectAtBoundary(input.stopping, 'Resolved stopping policy') }),
  }
}

const normalizeArtifact = (value: Hash | InvocationArtifact): InvocationArtifact =>
  typeof value === 'string' ? { id: value } : value

export const createInvocationRun = (
  input: Omit<InvocationRun, 'schemaVersion' | 'id' | 'artifacts'> & {
    artifacts: Record<string, Hash | InvocationArtifact>
  },
): InvocationRun => {
  if (input.resolvedPolicy.accuracy === 'approximate') {
    throw new Error('Approximate invocation execution is not available.')
  }
  const value = {
    schemaVersion: 2 as const,
    invocationId: input.invocationId,
    resolvedPolicy: input.resolvedPolicy,
    status: input.status,
    startedAtMs: input.startedAtMs,
    completedAtMs: input.completedAtMs,
    artifacts: Object.fromEntries(
      Object.entries(input.artifacts).map(([name, artifact]) => [
        name,
        normalizeArtifact(artifact),
      ]),
    ),
    provenance: input.provenance,
    ...(input.error === undefined ? {} : { error: input.error }),
  }
  return { ...value, id: hashIdentity('taskyon.invocationRun.v2', value) }
}

export const parseInvocationRun = (value: unknown): InvocationRun => {
  const input = objectAtBoundary(value, 'Invocation run')
  if (
    input.schemaVersion !== 2 ||
    (input.status !== 'completed' && input.status !== 'failed' && input.status !== 'cancelled')
  ) {
    throw new Error('Unsupported invocation run.')
  }
  const artifacts = Object.fromEntries(
    Object.entries(objectAtBoundary(input.artifacts, 'Invocation run artifacts')).map(
      ([name, artifactValue]) => {
        const artifact = objectAtBoundary(artifactValue, `Invocation artifact ${name}`)
        return [
          name,
          {
            id: hashAtBoundary(artifact.id, `Invocation artifact ${name} id`),
            ...(typeof artifact.mediaType === 'string' ? { mediaType: artifact.mediaType } : {}),
            ...(typeof artifact.size === 'number' ? { size: artifact.size } : {}),
          },
        ]
      },
    ),
  )
  const record = createInvocationRun({
    invocationId: hashAtBoundary(input.invocationId, 'Invocation run invocation id'),
    resolvedPolicy: parseResolvedPolicy(input.resolvedPolicy),
    status: input.status,
    startedAtMs: numberAtBoundary(input.startedAtMs, 'Invocation run start'),
    completedAtMs: numberAtBoundary(input.completedAtMs, 'Invocation run completion'),
    artifacts,
    provenance: objectAtBoundary(input.provenance, 'Invocation run provenance'),
    ...(typeof input.error === 'string' ? { error: input.error } : {}),
  })
  assertIdentity(input.id, record.id, 'Invocation run')
  return record
}

export const parseExecutionAttempt = (value: unknown): ExecutionAttempt => {
  const input = objectAtBoundary(value, 'Execution attempt')
  if (
    input.schemaVersion !== 2 ||
    (input.status !== 'queued' &&
      input.status !== 'running' &&
      input.status !== 'cancelling' &&
      input.status !== 'finalizing')
  ) {
    throw new Error('Unsupported execution attempt.')
  }
  return {
    schemaVersion: 2,
    attemptId: stringAtBoundary(input.attemptId, 'Execution attempt id'),
    invocationId: hashAtBoundary(input.invocationId, 'Execution attempt invocation id'),
    status: input.status,
    completedRows: integerAtBoundary(input.completedRows, 'Execution attempt completed rows'),
    ...(input.totalRows === undefined
      ? {}
      : { totalRows: integerAtBoundary(input.totalRows, 'Execution attempt total rows') }),
    ...(input.checkpointArtifactId === undefined
      ? {}
      : {
          checkpointArtifactId: hashAtBoundary(
            input.checkpointArtifactId,
            'Execution attempt checkpoint',
          ),
        }),
    startedAtMs: numberAtBoundary(input.startedAtMs, 'Execution attempt start'),
    updatedAtMs: numberAtBoundary(input.updatedAtMs, 'Execution attempt update'),
  }
}
