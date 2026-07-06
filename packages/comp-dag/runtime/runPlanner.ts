import type { StudyInputOption } from '../dagCore'
import { parseSchema, type DagJsonSchema } from '../dagSchema'
import {
  setPathValue,
  type Objective,
  type OptimizationConfig,
  type VariableSpec,
} from '../optimization'
import { createStudyInputStrategyFromSelection } from '../studyStrategyLibrary'

export type SearchDimension = { path: string; values: unknown[] }

export type RunBudgetLimits = {
  maxRows: number | null
  maxEvals: number | null
  timeMs: number | null
  source: OptimizationConfig['budget']
}

export type PlannedRunSetup = {
  baseParams: Record<string, unknown>
  combinations: Record<string, unknown>[]
  dims: SearchDimension[]
  budget: RunBudgetLimits
  objective: Objective | undefined
  objectives: Objective[]
  dagInputs: Record<string, StudyInputOption> | undefined
}

export const DEFAULT_IMPLICIT_MAX_ROWS = 100

export const toDagExploreInputs = (
  raw: unknown,
): Record<string, StudyInputOption> | undefined => {
  if (!raw || typeof raw !== 'object') return undefined
  const entries = Object.entries(raw as Record<string, unknown>)
  if (entries.length === 0) return undefined

  const out: Record<string, StudyInputOption> = {}
  for (const [alias, spec] of entries) {
    if (!spec || typeof spec !== 'object') continue
    const s = spec as Record<string, unknown>
    const providerRaw = s.provider
    const mode = s.mode === 'zip' || s.mode === 'cross' ? s.mode : undefined
    const zipGroup = typeof s.zipGroup === 'string' ? s.zipGroup : undefined
    const sortByRaw = s.sortBy
    const sortByEntries: Array<{ path: string; direction?: 'asc' | 'desc' }> = []
    if (Array.isArray(sortByRaw)) {
      for (const x of sortByRaw) {
        if (!x || typeof x !== 'object') continue
        const path = (x as Record<string, unknown>).path
        const direction = (x as Record<string, unknown>).direction
        if (typeof path !== 'string' || path.length === 0) continue
        if (direction === 'asc' || direction === 'desc') {
          sortByEntries.push({ path, direction })
        } else {
          sortByEntries.push({ path })
        }
      }
    }

    const next: StudyInputOption = {}
    if (providerRaw && typeof providerRaw === 'object') {
      const providerObj = providerRaw as Record<string, unknown>
      if (providerObj.kind === 'name' && typeof providerObj.name === 'string') {
        next.provider = providerObj.name
      }
      if (
        providerObj.kind === 'index' &&
        typeof providerObj.index === 'number' &&
        Number.isFinite(providerObj.index)
      ) {
        next.provider = providerObj.index
      }
    }
    if (mode) next.mode = mode
    if (zipGroup) next.zipGroup = zipGroup
    if (sortByEntries.length > 0) next.sortBy = sortByEntries
    const strategyRaw =
      s.strategy && typeof s.strategy === 'object'
        ? (s.strategy as Record<string, unknown>)
        : undefined
    const strategyId =
      strategyRaw && typeof strategyRaw.id === 'string' ? strategyRaw.id : 'sequential'
    const strategyArgs =
      strategyRaw &&
      strategyRaw.args &&
      typeof strategyRaw.args === 'object' &&
      !Array.isArray(strategyRaw.args)
        ? (strategyRaw.args as Record<string, unknown>)
        : undefined
    next.strategy = createStudyInputStrategyFromSelection(
      strategyArgs ? { id: strategyId, args: strategyArgs } : { id: strategyId },
    )

    out[alias] = next
  }

  return Object.keys(out).length > 0 ? out : undefined
}

export const buildCombinations = (dims: SearchDimension[]): Record<string, unknown>[] => {
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

export const dimensionValuesFromSpec = (path: string, spec: VariableSpec): SearchDimension | null => {
  if (spec.kind === 'grid' || spec.kind === 'list') {
    const values = spec.values
    if (!Array.isArray(values) || values.length === 0)
      throw new Error(`Variable has no values: ${path}`)
    return { path, values }
  }

  if (spec.kind === 'sweep') {
    if (spec.method !== 'linear') {
      throw new Error(`Sweep method not implemented yet: ${spec.method} (${path})`)
    }

    const start = (spec as unknown as { start?: unknown }).start
    const end = (spec as unknown as { end?: unknown }).end
    const step = (spec as unknown as { step?: unknown }).step

    if (typeof start !== 'number' || !Number.isFinite(start)) {
      throw new Error(`Sweep start must be a finite number: ${path}`)
    }
    if (typeof end !== 'number' || !Number.isFinite(end)) {
      throw new Error(`Sweep end must be a finite number: ${path}`)
    }
    if (typeof step !== 'number' || !Number.isFinite(step)) {
      throw new Error(`Sweep step must be a finite number: ${path}`)
    }
    if (step === 0) throw new Error(`Sweep step cannot be 0: ${path}`)

    const values: number[] = []
    const forward = end >= start
    if (forward && step < 0) throw new Error(`Sweep step must be positive: ${path}`)
    if (!forward && step > 0) throw new Error(`Sweep step must be negative: ${path}`)

    for (let x = start; forward ? x <= end : x >= end; x += step) {
      values.push(x)
      if (values.length > 100000) throw new Error(`Sweep produced too many values: ${path}`)
    }

    if (values.length === 0) throw new Error(`Sweep produced no values: ${path}`)
    return { path, values }
  }

  return null
}

export const normalizeBudget = (
  config: OptimizationConfig,
  implicitMaxRows: number = DEFAULT_IMPLICIT_MAX_ROWS,
): RunBudgetLimits => {
  const source = config.budget ?? { maxRows: implicitMaxRows }
  const maxRows =
    typeof source.maxRows === 'number' && Number.isFinite(source.maxRows)
      ? Math.max(0, Math.floor(source.maxRows))
      : null
  const maxEvals =
    typeof source.maxEvals === 'number' && Number.isFinite(source.maxEvals)
      ? Math.max(0, Math.floor(source.maxEvals))
      : null
  const timeMs =
    typeof source.timeMs === 'number' && Number.isFinite(source.timeMs)
      ? Math.max(0, Math.floor(source.timeMs))
      : null
  return { maxRows, maxEvals, timeMs, source }
}

export const buildRunPlan = (input: {
  config: OptimizationConfig
  paramsSchema: DagJsonSchema
  implicitMaxRows?: number
}): PlannedRunSetup => {
  const { config, paramsSchema } = input
  const budget = normalizeBudget(config, input.implicitMaxRows)

  const baseParamsRaw: Record<string, unknown> = {}
  const dims: SearchDimension[] = []
  for (const [path, spec] of Object.entries(config.variables)) {
    if (spec.kind === 'constant') {
      if ((spec as { value?: unknown }).value !== undefined) {
        setPathValue(baseParamsRaw, path, (spec as { value?: unknown }).value)
      }
      continue
    }
    const dim = dimensionValuesFromSpec(path, spec)
    if (!dim) throw new Error(`Unsupported variable kind: ${(spec as VariableSpec).kind} (${path})`)
    dims.push(dim)
    const legacyValue = (spec as unknown as { value?: unknown }).value
    const seed = dim.values[0] !== undefined ? dim.values[0] : legacyValue
    setPathValue(baseParamsRaw, path, seed)
  }

  const baseParams = parseSchema<Record<string, unknown>>(paramsSchema, baseParamsRaw)
  const combinations = buildCombinations(dims)
  const objective = config.objective
  const objectives = objective ? [objective] : []
  const dagInputs = toDagExploreInputs((config as { inputs?: unknown }).inputs)

  return {
    baseParams,
    combinations,
    dims,
    budget,
    objective,
    objectives,
    dagInputs,
  }
}
