import type { EngineConfig, NodeContext, StudyOptions, StudyResult, StudyRowEvent } from '../dagCore'
import type { Objective, OptimizationConfig, OptimizationResults, OptimizationRunRecord } from '../optimization'
import { setPathValue } from '../optimization'
import { compileObjectiveQuery, createRowSourceNode } from '../queryPipeline'
import {
  LONG_RUN_CHECK_INTERVAL_MS,
  LONG_RUN_MIN_SAMPLES,
  LONG_RUN_WARNING_THRESHOLD_MS,
  computePercent,
  remainingRowsForEta,
  totalRowsForEta,
} from './runProgress'
import type { PlannedRunSetup } from './runPlanner'
import type { LazyOptimizationRunRecord, StoredOptimizationRunRecord } from './resultPersistence'

type ObjectiveValue = number | null
type ObjectiveMap = Record<string, ObjectiveValue>

const clone = <T>(value: T): T => {
  const sc = (globalThis as unknown as { structuredClone?: (v: unknown) => unknown }).structuredClone
  if (typeof sc === 'function') {
    try {
      return sc(value) as T
    } catch {
      // fall through
    }
  }
  return JSON.parse(JSON.stringify(value)) as T
}

const objectiveKeyOf = (objective: Objective): string => {
  const op = objective.target.op ?? 'identity'
  const index =
    op === 'index' && Number.isInteger(objective.target.index) ? `[${objective.target.index}]` : ''
  return `${objective.target.path}|${op}${index}`
}

const describeUnknownError = (error: unknown): string => {
  if (error instanceof Error) return error.message
  try {
    return typeof error === 'string' ? error : JSON.stringify(error)
  } catch {
    return String(error)
  }
}

const compareObjectives = (
  a: ObjectiveMap,
  b: ObjectiveMap,
  objectives: Objective[],
): -1 | 0 | 1 => {
  for (const obj of objectives) {
    const key = objectiveKeyOf(obj)
    const va0: ObjectiveValue = a[key] ?? null
    const vb0: ObjectiveValue = b[key] ?? null

    const va =
      va0 === null
        ? obj.direction === 'min'
          ? Number.POSITIVE_INFINITY
          : Number.NEGATIVE_INFINITY
        : va0
    const vb =
      vb0 === null
        ? obj.direction === 'min'
          ? Number.POSITIVE_INFINITY
          : Number.NEGATIVE_INFINITY
        : vb0

    if (va === vb) continue
    if (obj.direction === 'min') return va < vb ? -1 : 1
    return va > vb ? -1 : 1
  }
  return 0
}

export type ExecutorStatusPatch = {
  phase?: 'planning' | 'running' | 'awaiting_confirmation' | 'finalizing' | 'done' | 'stopped' | 'error'
  status?: 'running' | 'done' | 'stopped' | 'error'
  plannedRows?: number
  completedRows?: number
  plannedCombos?: number
  completedCombos?: number
  percent?: number
  etaMs?: number | null
  avgMsPerRow?: number | null
  message?: string | null
  requiresContinueConfirm?: boolean
  longRunDetected?: boolean
  warningTriggeredAtMs?: number | null
  warningReason?: string | null
}

export type ExecuteRunInput = {
  nodeKey: string
  node: {
    name: string
    paramsSchema: { parse: (input: unknown) => unknown }
    call: (params: unknown) => {
      study: (
        opts: StudyOptions,
        ctx?: NodeContext,
        engineConfig?: EngineConfig,
      ) => Promise<StudyResult<unknown>>
    }
  }
  config: OptimizationConfig
  planning: PlannedRunSetup
  defaultNodeCtx: NodeContext
  engineConfig: EngineConfig
  inputDebug: unknown
  activeProjectId: string
  activeProblemId: string
  isStopRequested: () => boolean
  requestStop: () => void
  awaitContinuationDecision: () => Promise<boolean>
  estimateDuration: (avgMsPerRow: number, totalRows: number) => Promise<number>
  persistRow: (args: {
    projectId: string
    problemId: string
    startedAtMs: number
    runIndex: number
    row: StoredOptimizationRunRecord
  }) => LazyOptimizationRunRecord
  shouldPersistCheckpoint: (args: { completedRows: number; nowMs: number; stopRequested: boolean }) => boolean
  onCheckpoint: () => void
  onStatus: (patch: ExecutorStatusPatch) => void
  onStatusLog: (message: string, data?: unknown, level?: 'info' | 'warn' | 'error') => void
  onModelLog: (message: string, data?: unknown, level?: 'info' | 'warn' | 'error') => void
  onLiveRow: (row: {
    runIndex: number
    comboIndex: number
    rowIndex: number
    rowKey: Record<string, string | number>
    path: string
  }) => void
  onDebug: (debug: Record<string, unknown>) => void
  initialResults: OptimizationResults
}

export type ExecuteRunOutput = {
  results: OptimizationResults
  stopped: boolean
}

export const createRunExecutorService = (deps?: { now?: () => number }) => {
  const now = deps?.now ?? (() => Date.now())

  const execute = async (input: ExecuteRunInput): Promise<ExecuteRunOutput> => {
    const startedAtMs = now()
    const { node, planning, config } = input
    const { combinations, baseParams, dagInputs, objectives, objective, budget } = planning
    const totalCombos = combinations.length
    const mergedReverseMaps: Record<string, Record<string, number>> = {}
    const runs: OptimizationRunRecord[] = []
    let bestIndex: number | null = null
    let bestObjectives: ObjectiveMap | null = null
    let completedCombos = 0
    let completedRows = 0
    let plannedRows = 0
    let comboYieldCounter = 0
    let lastLongRunCheckAtMs = 0
    let hasShownLongRunWarning = false

    const budgetMaxRows = budget.maxRows
    const budgetMaxEvals = budget.maxEvals
    const budgetTimeMs = budget.timeMs
    const objectiveNode =
      config.mode === 'optimize' && objective
        ? compileObjectiveQuery({
            sourceNode: createRowSourceNode({ name: `RuntimeObjectiveRowSourceNode_${startedAtMs}` }),
            objective: {
              direction: objective.direction,
              target: {
                path: objective.target.path,
                op: objective.target.op,
                ...(Number.isInteger(objective.target.index)
                  ? { index: objective.target.index as number }
                  : {}),
              },
            },
            namePrefix: `runtime_objective_${startedAtMs}`,
          }).objectiveNode
        : null
    const objectiveKey = objective ? objectiveKeyOf(objective) : null

    const updateRunProgress = async (message?: string, requiresContinueConfirm = false) => {
      const elapsedMs = now() - startedAtMs
      const avgMsPerRow = completedRows > 0 ? elapsedMs / completedRows : null
      const totalRows = totalRowsForEta(plannedRows, totalCombos, budgetMaxRows)
      const remainingRows = remainingRowsForEta(completedRows, totalRows)
      let etaMs: number | null = null
      const fallbackEtaMs =
        avgMsPerRow != null && Number.isFinite(avgMsPerRow)
          ? Math.round(avgMsPerRow * remainingRows)
          : null

      if (avgMsPerRow != null && Number.isFinite(avgMsPerRow)) {
        try {
          const estimatePromise = input.estimateDuration(avgMsPerRow, remainingRows)
          const timeoutPromise = new Promise<number>((resolve) => {
            setTimeout(() => resolve(fallbackEtaMs ?? 0), 300)
          })
          etaMs = await Promise.race([estimatePromise, timeoutPromise])
        } catch {
          etaMs = fallbackEtaMs
        }
      }

      const completedRowsForDisplay = Math.min(completedRows, totalRows > 0 ? totalRows : completedRows)
      input.onStatus({
        status: 'running',
        phase: requiresContinueConfirm ? 'awaiting_confirmation' : 'running',
        plannedRows: totalRows,
        completedRows: completedRowsForDisplay,
        plannedCombos: totalCombos,
        completedCombos,
        percent: computePercent(completedRowsForDisplay, totalRows),
        etaMs,
        avgMsPerRow,
        message:
          message ??
          `Rows ${completedRowsForDisplay}/${totalRows} | combos ${completedCombos}/${totalCombos}`,
      })
    }

    input.onStatus({
      phase: 'running',
      status: 'running',
      plannedCombos: totalCombos,
      completedCombos: 0,
      plannedRows: 0,
      completedRows: 0,
      percent: 0,
      message: `Running combo 0 of ${totalCombos}`,
    })

    for (let i = 0; i < combinations.length; i += 1) {
      comboYieldCounter += 1
      if (comboYieldCounter % 3 === 0) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 0)
        })
      }
      if (input.isStopRequested()) break
      if (budgetMaxRows != null && completedRows >= budgetMaxRows) break
      if (budgetTimeMs != null && now() - startedAtMs >= budgetTimeMs) break

      const patch = combinations[i]!
      const params: Record<string, unknown> = clone(baseParams)
      for (const [path, value] of Object.entries(patch)) setPathValue(params, path, value)
      const validated = node.paramsSchema.parse(params)

      const cleanedBudget: StudyOptions['budget'] = {}
      if (budgetMaxRows != null) {
        const remaining = budgetMaxRows - completedRows
        if (remaining <= 0) break
        cleanedBudget.maxRows = remaining
      }
      if (budgetMaxEvals != null) {
        const remaining = budgetMaxEvals - completedRows
        if (remaining <= 0) break
        cleanedBudget.maxEvals = remaining
      }
      if (budgetTimeMs != null) {
        const remaining = budgetTimeMs - (now() - startedAtMs)
        if (remaining <= 0) break
        cleanedBudget.timeMs = remaining
      }

      const commonStudyOpts: StudyOptions = {
        ...(dagInputs ? { inputs: dagInputs } : {}),
        ...(Object.keys(cleanedBudget).length > 0 ? { budget: cleanedBudget } : {}),
        ...(Array.isArray(config.capture) && config.capture.length > 0
          ? { capture: config.capture }
          : {}),
        ...(typeof config.rngSeed === 'number' && Number.isInteger(config.rngSeed)
          ? { rngSeed: config.rngSeed }
          : {}),
        mode: 'explore',
      }

      const planResult = await node.call(validated).study(
        {
          ...commonStudyOpts,
          dryRun: true,
        },
        input.defaultNodeCtx,
        input.engineConfig,
      )
      plannedRows += Math.max(0, planResult.plan && typeof planResult.plan === 'object'
        ? ((planResult.plan as { estimatedRows?: number }).estimatedRows ?? 0)
        : 0)
      if (typeof cleanedBudget.maxRows === 'number') {
        plannedRows = Math.min(plannedRows, cleanedBudget.maxRows)
      }
      await updateRunProgress(`Running combo ${i + 1} of ${totalCombos}`)

      let comboRowCounter = 0
      let studyResult: StudyResult<unknown>
      try {
        studyResult = await node.call(validated).study(
          {
            ...commonStudyOpts,
            onRow: async (event: StudyRowEvent<unknown>) => {
            if (input.isStopRequested()) throw new Error('Run stopped by user.')
            if (budgetMaxRows != null && completedRows >= budgetMaxRows) {
              input.requestStop()
              throw new Error('Run stopped by budget.')
            }
            if (budgetTimeMs != null && now() - startedAtMs >= budgetTimeMs) {
              input.requestStop()
              throw new Error('Run stopped by budget.')
            }

            const nowMs = now()
            const outputs =
              event.row && typeof event.row === 'object'
                ? (event.row as Record<string, unknown>)
                : ({ value: event.row } as Record<string, unknown>)
            const objMap: ObjectiveMap = {}
            if (objectiveNode && objectiveKey) {
              try {
                const objectiveRun = await objectiveNode
                  .call({
                    params: validated,
                    outputs,
                  })
                  .run(input.defaultNodeCtx, input.engineConfig)
                const rawValue = (objectiveRun.value as { value?: unknown }).value
                objMap[objectiveKey] =
                  typeof rawValue === 'number' && Number.isFinite(rawValue) ? rawValue : null
              } catch {
                objMap[objectiveKey] = null
              }
            }

            const runIndex = runs.length
            const rowKey = event.rowKey ?? {}
            const rowRecord: StoredOptimizationRunRecord = {
              params: validated,
              outputs,
              objectives: objMap,
              ...(event.captured ? { captured: event.captured } : {}),
              rowKey,
              comboIndex: i,
              comboRowIndex: comboRowCounter,
            }
            const lazyRow = input.persistRow({
              projectId: input.activeProjectId,
              problemId: input.activeProblemId,
              startedAtMs,
              runIndex,
              row: rowRecord,
            })
            runs.push(lazyRow as unknown as OptimizationRunRecord)
            input.onLiveRow({
              runIndex,
              comboIndex: i,
              rowIndex: comboRowCounter,
              rowKey,
              path: lazyRow.path,
            })

            comboRowCounter += 1
            completedRows += 1

            if (
              input.shouldPersistCheckpoint({
                completedRows,
                nowMs,
                stopRequested: input.isStopRequested(),
              })
            ) {
              input.onCheckpoint()
            }

            if (config.mode === 'optimize' && objectives.length > 0) {
              if (bestIndex === null || bestObjectives === null) {
                bestIndex = runs.length - 1
                bestObjectives = objMap
              } else if (compareObjectives(objMap, bestObjectives, objectives) === -1) {
                bestIndex = runs.length - 1
                bestObjectives = objMap
              }
            }

            await updateRunProgress(undefined, false)

            if (
              !hasShownLongRunWarning &&
              completedRows >= LONG_RUN_MIN_SAMPLES &&
              (lastLongRunCheckAtMs === 0 || nowMs - lastLongRunCheckAtMs >= LONG_RUN_CHECK_INTERVAL_MS)
            ) {
              lastLongRunCheckAtMs = nowMs
              const totalRowsForProjection = plannedRows > 0 ? plannedRows : Math.max(totalCombos, completedRows)
              const avgMsPerRow = completedRows > 0 ? (nowMs - startedAtMs) / completedRows : null
              if (avgMsPerRow != null) {
                let projectedTotalMs = avgMsPerRow * totalRowsForProjection
                try {
                  projectedTotalMs = await input.estimateDuration(avgMsPerRow, totalRowsForProjection)
                } catch {
                  // keep fallback estimate
                }
                if (projectedTotalMs > LONG_RUN_WARNING_THRESHOLD_MS) {
                  hasShownLongRunWarning = true
                  input.onStatus({
                    longRunDetected: true,
                    requiresContinueConfirm: true,
                    warningTriggeredAtMs: nowMs,
                    warningReason: `Projected runtime ${Math.round(
                      projectedTotalMs / 1000,
                    )}s exceeds warning threshold.`,
                    phase: 'awaiting_confirmation',
                    message: 'Run paused: projected runtime exceeds threshold.',
                  })
                  input.onStatusLog(
                    'Projected runtime exceeded threshold; awaiting confirmation.',
                    {
                      projectedTotalMs,
                      thresholdMs: LONG_RUN_WARNING_THRESHOLD_MS,
                      completedRows,
                      plannedRows: totalRowsForProjection,
                    },
                    'warn',
                  )
                  const shouldContinue = await input.awaitContinuationDecision()
                  if (!shouldContinue) {
                    input.requestStop()
                    throw new Error('Run stopped by user.')
                  }
                  input.onStatus({
                    requiresContinueConfirm: false,
                    warningReason: null,
                    phase: 'running',
                    message: 'Resuming run...',
                  })
                }
              }
            }
            },
          },
          input.defaultNodeCtx,
          input.engineConfig,
        )
      } catch (error) {
        const detail = describeUnknownError(error)
        const wrapped = new Error(
          `Run executor failed in node "${node.name}" during combo ${i + 1}/${totalCombos}: ${detail}`,
        )
        ;(wrapped as Error & { cause?: unknown }).cause = error
        throw wrapped
      }

      input.onModelLog('Study result received', {
        comboIndex: i,
        comboCount: totalCombos,
        rowsInCombo: studyResult.rows.length,
        rowKeysInCombo: studyResult.rowKeys.length,
      })
      completedCombos = i + 1
      await updateRunProgress(undefined, false)

      input.onDebug({
        inputs: dagInputs ?? {},
        inputDebug: input.inputDebug,
        comboIndex: i,
        comboCount: totalCombos,
        plan: studyResult.plan,
        mergedReverseMaps,
        lastRowKeys: studyResult.rowKeys.slice(0, 25),
        totalRows: runs.length,
      })

      if (input.isStopRequested()) break
    }

    const finishedAtMs = now()
    const stopped = input.isStopRequested()
    input.onStatus({
      phase: 'finalizing',
      status: stopped ? 'stopped' : 'running',
      message: stopped ? 'Finalizing partial results...' : 'Finalizing results...',
    })

    const results: OptimizationResults = {
      ...(input.initialResults ?? {
        nodeKey: input.nodeKey,
        nodeName: node.name,
        mode: config.mode,
        runs,
      }),
      runs,
      bestIndex: config.mode === 'optimize' ? bestIndex : null,
      meta: {
        startedAtMs,
        finishedAtMs,
        totalCombos,
        totalRuns: runs.length,
        inputDebug: input.inputDebug,
        inputOptions: dagInputs ?? {},
        mergedReverseMaps,
        stopped,
        stoppedAtRow: stopped ? runs.length : null,
        defaultBudgetApplied: !config.budget,
        effectiveBudget: planning.budget.source,
      },
    } as unknown as OptimizationResults

    if (stopped) {
      input.onStatus({
        status: 'stopped',
        phase: 'stopped',
        percent: 100,
        etaMs: null,
        message: `Stopped (${runs.length} rows preserved)`,
      })
    } else {
      input.onStatus({
        status: 'done',
        phase: 'done',
        percent: 100,
        completedRows: runs.length,
        plannedRows: Math.max(plannedRows, runs.length),
        etaMs: 0,
        message: `Done (${runs.length} rows)`,
      })
    }

    return { results, stopped }
  }

  return { execute }
}
