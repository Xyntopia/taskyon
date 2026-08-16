import type { Hash } from './caching.ts'
import type { DagNode, EngineConfig, NodeContext } from './dagCore.ts'
import {
  createInvocationRun,
  type ExecutionAttempt,
  type InvocationArtifact,
  type InvocationDefinition,
  type InvocationRun,
  type ResolvedInvocationPolicy,
} from './designGraphModel.ts'
import type { DesignGraphRepository } from './designGraphRepository.ts'
import { evaluateDerivedOperations, type DerivedOperation } from './derivedExpression.ts'
import { getPathValue, setPathValue, type VariableSpec } from './optimization.ts'
import { toDagExploreInputs } from './runtime/runPlanner.ts'

export type InvocationRow = {
  rowId: number
  params: Record<string, unknown>
  outputs: unknown
  objectives: Record<string, number | null>
  constraints: Record<string, boolean>
  feasible: boolean
  inputSelection?: {
    rowKey: Record<string, string | number>
    sourceIndexByAlias: Record<string, number>
  }
  captured?: Record<string, unknown>
}

export type StagedArtifactWriter = {
  write: (chunk: Uint8Array) => Promise<void>
  commit: () => Promise<InvocationArtifact>
  abort: () => Promise<void>
}

export type InvocationArtifactStore = {
  begin: (mediaType: string) => Promise<StagedArtifactWriter>
  write: (value: unknown, mediaType: string) => Promise<InvocationArtifact>
  exists: (artifact: InvocationArtifact) => Promise<boolean>
}

export type InvocationExecutionDependencies = {
  repository: DesignGraphRepository
  artifacts: InvocationArtifactStore
  evaluate: (args: {
    rootNodeId: Hash
    params: Record<string, unknown>
    signal?: AbortSignal
  }) => Promise<{ outputs: unknown; captured?: Record<string, unknown> }>
  evaluateRows?: (args: {
    rootNodeId: Hash
    params: Record<string, unknown>
    maxRows?: number
    signal?: AbortSignal
    onRow: (row: {
      outputs: unknown
      captured?: Record<string, unknown>
      inputSelection?: InvocationRow['inputSelection']
    }) => Promise<void>
  }) => Promise<void>
  makeAttemptId: () => string
  now?: () => number
}

export const createDagInvocationEvaluators = (args: {
  root: DagNode
  invocation: InvocationDefinition
  engineConfig?: EngineConfig
  nodeContext?: NodeContext
}): Pick<InvocationExecutionDependencies, 'evaluate' | 'evaluateRows'> => ({
  evaluate: async ({ params, signal }) => {
    if (signal?.aborted) throw new Error('Invocation cancelled.')
    const result = await args.root.call(params).run(args.nodeContext, args.engineConfig)
    return { outputs: result.value }
  },
  evaluateRows: async ({ params, maxRows, signal, onRow }) => {
    if (signal?.aborted) throw new Error('Invocation cancelled.')
    const inputs = toDagExploreInputs(args.invocation.inputs)
    const studyParams = Object.fromEntries(
      Object.keys(args.invocation.inputs).map((alias) => [alias, params[alias] ?? {}]),
    )
    await args.root.call({ ...params, ...studyParams }).study(
      {
        ...(args.invocation.objectives[0]?.target.op === 'identity'
          ? {
              mode: 'optimize' as const,
              objective: {
                path: args.invocation.objectives[0].target.path,
                direction: args.invocation.objectives[0].direction,
              },
            }
          : {}),
        ...(inputs ? { inputs } : {}),
        capture: args.invocation.capture.map((capture) => ({
          path: capture.path,
          ...(capture.as === undefined ? {} : { as: capture.as }),
        })),
        ...(maxRows === undefined ? {} : { budget: { maxRows } }),
        collectRows: false,
        collectHistory: Object.values(args.invocation.inputs).some(
          (input) => input.strategy?.id !== undefined && input.strategy.id !== 'sequential',
        ),
        onRow: async (row) =>
          await onRow({
            outputs: row.row,
            ...(row.captured ? { captured: row.captured } : {}),
            inputSelection: {
              rowKey: row.rowKey,
              sourceIndexByAlias: row.sourceIndexByAlias,
            },
          }),
      },
      args.nodeContext,
      args.engineConfig,
    )
  },
})

const finiteValues = function* (variable: VariableSpec): Iterable<unknown> {
  switch (variable.kind) {
    case 'constant':
      yield variable.value
      return
    case 'grid':
    case 'list':
      yield* variable.values
      return
    case 'sweep': {
      if (variable.step === 0) throw new Error('Invocation sweep step must not be zero.')
      const increasing = variable.end >= variable.start
      if ((increasing && variable.step < 0) || (!increasing && variable.step > 0)) {
        throw new Error('Invocation sweep step moves away from its end value.')
      }
      for (
        let value = variable.start;
        increasing ? value <= variable.end : value >= variable.end;
        value += variable.step
      ) {
        yield value
      }
    }
  }
}

const candidateProduct = function* (
  entries: Array<[string, VariableSpec]>,
  index: number,
  current: Record<string, unknown>,
): Iterable<Record<string, unknown>> {
  if (index === entries.length) {
    yield current
    return
  }
  const [path, variable] = entries[index]!
  for (const value of finiteValues(variable)) {
    const next = structuredClone(current)
    if (value !== undefined) setPathValue(next, path, value)
    yield* candidateProduct(entries, index + 1, next)
  }
}

export const iterateInvocationCandidates = function* (
  invocation: Pick<InvocationDefinition, 'variables'>,
): Iterable<Record<string, unknown>> {
  const entries = Object.entries(invocation.variables)
  if (entries.length === 0) {
    yield {}
    return
  }
  yield* candidateProduct(entries, 0, {})
}

export const resolveInvocationPolicy = (
  invocation: InvocationDefinition,
): ResolvedInvocationPolicy => {
  if (invocation.policy.accuracy === 'approximate') {
    throw new Error('Approximate invocation execution is not available.')
  }
  const requestedStrategy = invocation.policy.optimizer ?? invocation.policy.estimator
  return {
    engine: { id: 'taskyon-row-stream', version: 1 },
    accuracy: 'exact',
    strategies: requestedStrategy ? { root: requestedStrategy } : {},
    ...(invocation.policy.seed === undefined ? {} : { seed: invocation.policy.seed }),
    ...(invocation.policy.tolerance === undefined
      ? {}
      : { tolerance: invocation.policy.tolerance }),
    ...(invocation.policy.stopping === undefined ? {} : { stopping: invocation.policy.stopping }),
  }
}

const objectiveKey = (index: number) => `objective-${index}`

const objectiveOperations = (target: InvocationDefinition['objectives'][number]['target']) => {
  const operations: DerivedOperation[] = [{ kind: 'select', path: target.path }]
  if (target.op === 'index') operations.push({ kind: 'index', index: target.index ?? 0 })
  else if (target.op !== 'identity') operations.push({ kind: 'reduce', reducer: target.op })
  return operations
}

const objectiveValues = async (
  invocation: InvocationDefinition,
  outputs: unknown,
): Promise<Record<string, number | null>> =>
  Object.fromEntries(
    await Promise.all(
      invocation.objectives.map(async (objective, index) => {
        const selected = await evaluateDerivedOperations(
          outputs,
          objectiveOperations(objective.target),
        )
        const value = typeof selected === 'number' && Number.isFinite(selected) ? selected : null
        return [objectiveKey(index), value]
      }),
    ),
  )

const constraintValues = (invocation: InvocationDefinition, outputs: unknown) =>
  Object.fromEntries(
    invocation.constraints.map((constraint, index) => {
      const actual = getPathValue(outputs, constraint.path)
      const satisfied =
        constraint.operator === '=='
          ? actual === constraint.limit
          : typeof actual === 'number' &&
            typeof constraint.limit === 'number' &&
            (constraint.operator === '<=' ? actual <= constraint.limit : actual >= constraint.limit)
      return [`constraint-${index}`, satisfied]
    }),
  )

const encode = (value: unknown) => new TextEncoder().encode(`${JSON.stringify(value)}\n`)

const allArtifactsExist = async (
  store: InvocationArtifactStore,
  run: InvocationRun,
): Promise<boolean> =>
  (
    await Promise.all(
      Object.values(run.artifacts).map(async (artifact) => await store.exists(artifact)),
    )
  ).every(Boolean)

const reusableRun = async (
  repository: DesignGraphRepository,
  artifacts: InvocationArtifactStore,
  invocationId: Hash,
  policy: ResolvedInvocationPolicy,
) => {
  const runs = await repository.listRuns(invocationId)
  for (const run of runs) {
    if (
      run.status === 'completed' &&
      JSON.stringify(run.resolvedPolicy) === JSON.stringify(policy) &&
      (await allArtifactsExist(artifacts, run))
    ) {
      return run
    }
  }
  return null
}

const persistAttempt = async (
  repository: DesignGraphRepository,
  attempt: ExecutionAttempt,
  patch: Partial<ExecutionAttempt>,
  now: () => number,
) => {
  const next: ExecutionAttempt = { ...attempt, ...patch, updatedAtMs: now() }
  await repository.putAttempt(next)
  return next
}

export const executeInvocation = async (args: {
  invocation: InvocationDefinition
  dependencies: InvocationExecutionDependencies
  reuseCompletedRun?: boolean
  signal?: AbortSignal
  onRow?: (row: InvocationRow) => void | Promise<void>
}): Promise<{ run: InvocationRun; cacheHit: boolean }> => {
  const { repository, artifacts } = args.dependencies
  const now = args.dependencies.now ?? Date.now
  const policy = resolveInvocationPolicy(args.invocation)
  if (args.reuseCompletedRun !== false) {
    const cached = await reusableRun(repository, artifacts, args.invocation.id, policy)
    if (cached) return { run: cached, cacheHit: true }
  }

  const startedAtMs = now()
  let attempt: ExecutionAttempt = {
    schemaVersion: 2,
    attemptId: args.dependencies.makeAttemptId(),
    invocationId: args.invocation.id,
    status: 'running',
    completedRows: 0,
    startedAtMs,
    updatedAtMs: startedAtMs,
  }
  await repository.putAttempt(attempt)
  const rowsWriter = await artifacts.begin('application/x-ndjson')
  const indexWriter = await artifacts.begin('application/x-ndjson')
  let rowId = 0
  let rowOffset = 0
  let terminalStatus: InvocationRun['status'] = 'completed'
  let terminalError: string | undefined

  const persistRow = async (
    params: Record<string, unknown>,
    evaluated: {
      outputs: unknown
      captured?: Record<string, unknown>
      inputSelection?: InvocationRow['inputSelection']
    },
  ) => {
    const constraints = constraintValues(args.invocation, evaluated.outputs)
    const row: InvocationRow = {
      rowId,
      params,
      outputs: evaluated.outputs,
      objectives: await objectiveValues(args.invocation, evaluated.outputs),
      constraints,
      feasible: Object.values(constraints).every(Boolean),
      ...(evaluated.inputSelection ? { inputSelection: evaluated.inputSelection } : {}),
      ...(evaluated.captured ? { captured: evaluated.captured } : {}),
    }
    const bytes = encode(row)
    await rowsWriter.write(bytes)
    await indexWriter.write(encode({ rowId, offset: rowOffset, length: bytes.byteLength }))
    rowOffset += bytes.byteLength
    rowId += 1
    attempt = await persistAttempt(repository, attempt, { completedRows: rowId }, now)
    await args.onRow?.(row)
  }

  try {
    for (const params of iterateInvocationCandidates(args.invocation)) {
      if (args.signal?.aborted) {
        terminalStatus = 'cancelled'
        terminalError = 'Invocation cancelled.'
        break
      }
      const maxRows = args.invocation.policy.budget?.maxRows
      if (args.dependencies.evaluateRows && Object.keys(args.invocation.inputs).length > 0) {
        await args.dependencies.evaluateRows({
          rootNodeId: args.invocation.rootNodeId,
          params,
          ...(maxRows === undefined ? {} : { maxRows: Math.max(0, maxRows - rowId) }),
          ...(args.signal ? { signal: args.signal } : {}),
          onRow: async (evaluated) => await persistRow(params, evaluated),
        })
      } else {
        await persistRow(
          params,
          await args.dependencies.evaluate({
            rootNodeId: args.invocation.rootNodeId,
            params,
            ...(args.signal ? { signal: args.signal } : {}),
          }),
        )
      }
      if (maxRows !== undefined && rowId >= maxRows) break
    }
  } catch (error) {
    terminalStatus = args.signal?.aborted ? 'cancelled' : 'failed'
    terminalError = error instanceof Error ? error.message : String(error)
  }

  attempt = await persistAttempt(repository, attempt, { status: 'finalizing' }, now)
  const rows = await rowsWriter.commit()
  const rowIndex = await indexWriter.commit()
  const summary = await artifacts.write(
    { rowCount: rowId, status: terminalStatus, ...(terminalError ? { error: terminalError } : {}) },
    'application/json',
  )
  const run = createInvocationRun({
    invocationId: args.invocation.id,
    resolvedPolicy: policy,
    status: terminalStatus,
    startedAtMs,
    completedAtMs: now(),
    artifacts: { rows, rowIndex, summary },
    provenance: { attemptId: attempt.attemptId },
    ...(terminalError ? { error: terminalError } : {}),
  })
  await repository.putRun(run)
  return { run, cacheHit: false }
}
