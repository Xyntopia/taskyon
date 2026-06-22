import type { OptimizationResults, OptimizationRunRecord } from '../optimization'

export type RunRowKey = Record<string, string | number>
export type StoredOptimizationRunRecord = OptimizationRunRecord & {
  rowKey?: RunRowKey
  comboIndex?: number
  comboRowIndex?: number
  status?: string
}

export type LazyOptimizationRunRecord = {
  __lazyRun: true
  runIndex: number
  runKey?: string
  rowKey?: RunRowKey
  comboIndex: number | null
  comboRowIndex: number | null
  path: string
  objectives?: Record<string, number | null>
  status?: string
}

export type PersistedOptimizationResultsSnapshotV1 = {
  version: 1
  nodeKey: string
  nodeName: string
  mode: 'explore' | 'optimize'
  bestIndex: number | null
  meta?: Record<string, unknown>
  runsCount: number
  startedAtMs: number | null
  runManifestPath?: string
}

export type RunManifestRow = {
  runIndex: number
  runKey: string
  rowKey: RunRowKey
  params: Record<string, unknown>
  objectives?: Record<string, number | null>
  captured?: Record<string, unknown>
  status?: string
  comboIndex?: number
  comboRowIndex?: number
  runPath: string
}

export type PersistedRunManifestV1 = {
  version: 1
  runId: string
  rowCount: number
  rows: RunManifestRow[]
}

type ResultsSnapshotPersistState = {
  refPath: string
  runsLength: number
  bestIndex: number | null
  startedAtMs: number | null
  lastWriteAtMs: number
}

type RunRowsPersistState = {
  startedAtMs: number | null
  persistedRunCount: number
}

export type ResultPersistenceDeps = {
  writeJson: (path: string, value: unknown) => Promise<void>
  readJson: <T>(path: string) => Promise<T>
  sanitizePathSegment: (value: string) => string
  now?: () => number
}

export const isLazyRunRecord = (value: unknown): value is LazyOptimizationRunRecord => {
  if (!value || typeof value !== 'object') return false
  const rec = value as Record<string, unknown>
  return rec.__lazyRun === true && typeof rec.path === 'string'
}

export const runRowKeyOf = (run: unknown): RunRowKey => {
  if (!run || typeof run !== 'object') return {}
  const rec = run as Record<string, unknown>
  const rowKey = rec.rowKey
  if (!rowKey || typeof rowKey !== 'object' || Array.isArray(rowKey)) return {}
  const values = Object.values(rowKey as Record<string, unknown>)
  const valid = values.every((v) => typeof v === 'string' || typeof v === 'number')
  return valid ? (rowKey as RunRowKey) : {}
}

export const runKeyFromRowKey = (rowKey: RunRowKey, runIndex: number): string => {
  const entries = Object.entries(rowKey)
  if (entries.length === 0) return `run-${runIndex}`
  return entries
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(', ')
    .slice(0, 180)
}

export const buildRunManifestRows = (args: {
  runs: unknown[]
  projectId: string
  problemId: string
  startedAtMs: number | null
  runArchivePathForIndex: (
    projectId: string,
    problemId: string,
    startedAtMs: number | null | undefined,
    index: number,
  ) => string
}): RunManifestRow[] => {
  const out: RunManifestRow[] = []
  for (let runIndex = 0; runIndex < args.runs.length; runIndex += 1) {
    const runRaw = args.runs[runIndex]
    if (!runRaw || typeof runRaw !== 'object') continue

    const rowKey = runRowKeyOf(runRaw)
    const runKey =
      isLazyRunRecord(runRaw) && typeof runRaw.runKey === 'string' && runRaw.runKey.length > 0
        ? runRaw.runKey
        : runKeyFromRowKey(rowKey, runIndex)

    const source = runRaw as Record<string, unknown>
    const paramsRaw = source.params
    const params =
      paramsRaw && typeof paramsRaw === 'object' && !Array.isArray(paramsRaw)
        ? (paramsRaw as Record<string, unknown>)
        : {}

    const objectivesRaw = source.objectives
    const objectives =
      objectivesRaw && typeof objectivesRaw === 'object' && !Array.isArray(objectivesRaw)
        ? (objectivesRaw as Record<string, number | null>)
        : undefined
    const capturedRaw = source.captured
    const captured =
      capturedRaw && typeof capturedRaw === 'object' && !Array.isArray(capturedRaw)
        ? (capturedRaw as Record<string, unknown>)
        : undefined

    out.push({
      runIndex,
      runKey,
      rowKey,
      params,
      ...(objectives ? { objectives } : {}),
      ...(captured ? { captured } : {}),
      ...(typeof source.status === 'string' ? { status: source.status } : {}),
      ...(typeof source.comboIndex === 'number' ? { comboIndex: source.comboIndex } : {}),
      ...(typeof source.comboRowIndex === 'number' ? { comboRowIndex: source.comboRowIndex } : {}),
      runPath: args.runArchivePathForIndex(args.projectId, args.problemId, args.startedAtMs, runIndex),
    })
  }
  return out
}

export const clone = <T>(value: T): T => {
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

const yieldToMainThread = async (): Promise<void> =>
  new Promise((resolve) => {
    const raf = (globalThis as unknown as { requestAnimationFrame?: (cb: () => void) => number })
      .requestAnimationFrame
    if (typeof raf === 'function') {
      raf(() => resolve())
      return
    }
    globalThis.setTimeout(resolve, 0)
  })

const estimateRunBytesFast = (value: unknown): number => {
  const seen = new Set<unknown>()
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }]
  let size = 0
  let visited = 0

  while (stack.length > 0 && visited < 600) {
    const cur = stack.pop()
    if (!cur) break
    const v = cur.value
    const depth = cur.depth

    if (v === null || v === undefined) {
      size += 4
      continue
    }
    if (typeof v === 'string') {
      size += Math.min(v.length, 256)
      continue
    }
    if (typeof v === 'number' || typeof v === 'boolean') {
      size += 8
      continue
    }
    if (typeof v !== 'object') {
      size += 16
      continue
    }
    if (seen.has(v)) continue
    seen.add(v)
    visited += 1

    if (Array.isArray(v)) {
      size += Math.min(v.length, 24) * 8
      if (depth < 1) {
        for (let i = 0; i < Math.min(v.length, 8); i += 1) {
          stack.push({ value: v[i], depth: depth + 1 })
        }
      }
      continue
    }

    const entries = Object.entries(v as Record<string, unknown>)
    size += Math.min(entries.length, 24) * 24
    if (depth < 1) {
      for (let i = 0; i < Math.min(entries.length, 12); i += 1) {
        const [k, child] = entries[i]!
        size += Math.min(k.length, 32)
        stack.push({ value: child, depth: depth + 1 })
      }
    }
  }

  return Math.max(512, size)
}

export const isPersistedOptimizationSnapshotV1 = (
  value: unknown,
): value is PersistedOptimizationResultsSnapshotV1 => {
  if (!value || typeof value !== 'object') return false
  const rec = value as Record<string, unknown>
  return (
    rec.version === 1 &&
    typeof rec.nodeKey === 'string' &&
    typeof rec.nodeName === 'string' &&
    (rec.mode === 'explore' || rec.mode === 'optimize') &&
    typeof rec.runsCount === 'number'
  )
}

export const createResultPersistenceService = (deps: ResultPersistenceDeps) => {
  const now = deps.now ?? (() => Date.now())

  const optimizationResultsSnapshotCache = new Map<string, OptimizationResults | null>()
  const optimizationResultsPersistStateByProblem = new Map<string, ResultsSnapshotPersistState>()
  const optimizationRunRowsPersistStateByProblem = new Map<string, RunRowsPersistState>()

  const runArchiveBasePathFor = (
    projectId: string,
    problemId: string,
    startedAtMs: number | null | undefined,
  ): string => {
    const safeProject = deps.sanitizePathSegment(projectId)
    const safeProblem = deps.sanitizePathSegment(problemId)
    const runId = startedAtMs != null ? String(startedAtMs) : String(now())
    return `joulios_project/run_rows/${safeProject}/${safeProblem}/${runId}`
  }

  const runArchivePathForIndex = (
    projectId: string,
    problemId: string,
    startedAtMs: number | null | undefined,
    index: number,
  ): string =>
    `${runArchiveBasePathFor(projectId, problemId, startedAtMs)}/run_${String(index).padStart(
      6,
      '0',
    )}.json`

  const optimizationResultsSnapshotPathFor = (projectId: string, problemId: string): string => {
    const safeProject = deps.sanitizePathSegment(projectId)
    const safeProblem = deps.sanitizePathSegment(problemId)
    return `joulios_project/run_results/${safeProject}/${safeProblem}/latest.json`
  }

  const runManifestPathFor = (
    projectId: string,
    problemId: string,
    startedAtMs: number | null | undefined,
  ): string => `${runArchiveBasePathFor(projectId, problemId, startedAtMs)}/manifest.json`

  const buildLazyRunsFromSnapshot = (
    projectId: string,
    problemId: string,
    startedAtMs: number | null,
    runsCount: number,
  ): LazyOptimizationRunRecord[] => {
    const out: LazyOptimizationRunRecord[] = []
    for (let i = 0; i < runsCount; i += 1) {
      out.push({
        __lazyRun: true,
        runIndex: i,
        comboIndex: null,
        comboRowIndex: null,
        path: runArchivePathForIndex(projectId, problemId, startedAtMs, i),
      })
    }
    return out
  }

  const persistRunRowsIncremental = (
    results: OptimizationResults,
    projectId: string,
    problemId: string,
  ): { runsLength: number; startedAtMs: number | null } => {
    const runs = Array.isArray(results.runs) ? results.runs : []
    const meta = (results as unknown as { meta?: unknown }).meta as
      | { startedAtMs?: unknown }
      | undefined
    const startedAtMs = typeof meta?.startedAtMs === 'number' ? meta.startedAtMs : null
    const runsLength = runs.length
    const problemKey = `${projectId}/${problemId}`

    const prev = optimizationRunRowsPersistStateByProblem.get(problemKey)
    const startIndex =
      prev && prev.startedAtMs === startedAtMs
        ? Math.max(0, Math.min(prev.persistedRunCount, runsLength))
        : 0

    for (let runIndex = startIndex; runIndex < runsLength; runIndex += 1) {
      const runRaw = runs[runIndex]
      if (!runRaw || typeof runRaw !== 'object') continue
      if (isLazyRunRecord(runRaw)) continue
      const run = runRaw as StoredOptimizationRunRecord
      const path = runArchivePathForIndex(projectId, problemId, startedAtMs, runIndex)
      void deps.writeJson(path, run).catch((e) => {
        console.warn('Failed to persist optimization run row', { path, error: e })
      })
    }

    optimizationRunRowsPersistStateByProblem.set(problemKey, {
      startedAtMs,
      persistedRunCount: runsLength,
    })

    return { runsLength, startedAtMs }
  }

  const persistOptimizationResultsSnapshot = (
    results: OptimizationResults | null,
    projectId: string,
    problemId: string,
  ): string | null => {
    const problemKey = `${projectId}/${problemId}`
    if (!results) {
      optimizationResultsPersistStateByProblem.delete(problemKey)
      optimizationRunRowsPersistStateByProblem.delete(problemKey)
      optimizationResultsSnapshotCache.delete(optimizationResultsSnapshotPathFor(projectId, problemId))
      return null
    }

    const { runsLength, startedAtMs } = persistRunRowsIncremental(results, projectId, problemId)
    const manifestPath = runManifestPathFor(projectId, problemId, startedAtMs)
    const manifestRows = buildRunManifestRows({
      runs: Array.isArray(results.runs) ? (results.runs as unknown[]) : [],
      projectId,
      problemId,
      startedAtMs,
      runArchivePathForIndex,
    })

    const manifestPayload: PersistedRunManifestV1 = {
      version: 1,
      runId: startedAtMs != null ? String(startedAtMs) : String(now()),
      rowCount: manifestRows.length,
      rows: manifestRows,
    }
    void deps.writeJson(manifestPath, manifestPayload).catch((e) => {
      console.warn('Failed to persist optimization run manifest', {
        manifestPath,
        projectId,
        problemId,
        error: e,
      })
    })

    const refPath = optimizationResultsSnapshotPathFor(projectId, problemId)
    const bestIndex = typeof results.bestIndex === 'number' ? results.bestIndex : null
    const resultsMeta = (results as unknown as { meta?: unknown }).meta
    const meta =
      resultsMeta && typeof resultsMeta === 'object'
        ? (resultsMeta as { finishedAtMs?: unknown })
        : undefined
    const isFinalized = typeof meta?.finishedAtMs === 'number'
    const nowMs = now()
    const prev = optimizationResultsPersistStateByProblem.get(problemKey)

    const shouldWrite =
      !prev ||
      prev.refPath !== refPath ||
      prev.startedAtMs !== startedAtMs ||
      isFinalized ||
      bestIndex !== prev.bestIndex ||
      runsLength !== prev.runsLength
        ? !prev ||
          prev.refPath !== refPath ||
          prev.startedAtMs !== startedAtMs ||
          isFinalized ||
          bestIndex !== prev.bestIndex ||
          runsLength - prev.runsLength >= 20 ||
          nowMs - prev.lastWriteAtMs >= 2000
        : false

    if (!shouldWrite) return prev?.refPath ?? refPath

    const snapshot: PersistedOptimizationResultsSnapshotV1 = {
      version: 1,
      nodeKey: results.nodeKey,
      nodeName: results.nodeName,
      mode: results.mode,
      bestIndex,
      ...(resultsMeta && typeof resultsMeta === 'object'
        ? { meta: resultsMeta as Record<string, unknown> }
        : {}),
      runsCount: runsLength,
      startedAtMs,
      runManifestPath: manifestPath,
    }

    const lazyRuns = buildLazyRunsFromSnapshot(projectId, problemId, startedAtMs, runsLength)
    optimizationResultsSnapshotCache.set(refPath, {
      nodeKey: snapshot.nodeKey,
      nodeName: snapshot.nodeName,
      mode: snapshot.mode,
      bestIndex: snapshot.bestIndex,
      runs: lazyRuns as unknown as OptimizationRunRecord[],
      meta: snapshot.meta,
    } as OptimizationResults)

    void deps.writeJson(refPath, snapshot).catch((e) => {
      console.warn('Failed to persist optimization results snapshot', {
        refPath,
        projectId,
        problemId,
        error: e,
      })
    })

    optimizationResultsPersistStateByProblem.set(problemKey, {
      refPath,
      runsLength,
      bestIndex,
      startedAtMs,
      lastWriteAtMs: nowMs,
    })

    return refPath
  }

  const readOptimizationResultsSnapshot = async (
    refPath: string,
    projectId: string,
    problemId: string,
  ): Promise<OptimizationResults | null> => {
    const loaded = await deps.readJson<unknown>(refPath)

    if (isPersistedOptimizationSnapshotV1(loaded)) {
      const runs = buildLazyRunsFromSnapshot(projectId, problemId, loaded.startedAtMs, loaded.runsCount)
      const loadedMeta =
        loaded.meta && typeof loaded.meta === 'object' ? loaded.meta : null
      return {
        nodeKey: loaded.nodeKey,
        nodeName: loaded.nodeName,
        mode: loaded.mode,
        bestIndex: loaded.bestIndex,
        runs: runs as unknown as OptimizationRunRecord[],
        ...(loadedMeta || loaded.runManifestPath
          ? {
              meta: {
                ...(loadedMeta ?? {}),
                ...(loaded.runManifestPath ? { runManifestPath: loaded.runManifestPath } : {}),
              },
            }
          : {}),
      } as OptimizationResults
    }

    if (loaded && typeof loaded === 'object') {
      return loaded as OptimizationResults
    }
    return null
  }

  const loadOptimizationRun = async (
    results: OptimizationResults | null,
    index: number,
    opts?: { hydrateInMemory?: boolean },
  ): Promise<{ run: StoredOptimizationRunRecord | null; results: OptimizationResults | null }> => {
    const current = results as unknown as { runs?: unknown[] } | null
    const runs = current?.runs
    if (!Array.isArray(runs) || index < 0 || index >= runs.length) return { run: null, results }
    const runRaw = runs[index]
    if (!isLazyRunRecord(runRaw)) {
      return {
        run: runRaw && typeof runRaw === 'object' ? (runRaw as StoredOptimizationRunRecord) : null,
        results,
      }
    }

    const path = runRaw.path
    try {
      const hydrated = await deps.readJson<StoredOptimizationRunRecord>(path)
      if (!opts?.hydrateInMemory) return { run: hydrated, results }

      const currentRuns = (results as unknown as { runs?: unknown[] } | null)?.runs
      if (Array.isArray(currentRuns) && index >= 0 && index < currentRuns.length) {
        currentRuns[index] = hydrated as unknown as OptimizationRunRecord
      }
      return { run: hydrated, results }
    } catch (e) {
      console.warn('Failed to lazy-load optimization run', { index, path, error: e })
      return { run: null, results }
    }
  }

  const loadOptimizationRunsRange = async (
    results: OptimizationResults | null,
    start: number,
    count: number,
    opts?: {
      hydrateInMemory?: boolean
      chunkSize?: number
      onProgress?: (progress: { loaded: number; total: number; estimatedBytes: number }) => void
    },
  ): Promise<{ loaded: number; results: OptimizationResults | null }> => {
    const runs = (results as unknown as { runs?: unknown[] } | null)?.runs
    if (!Array.isArray(runs) || runs.length === 0) return { loaded: 0, results }
    const from = Math.max(0, Math.floor(start))
    const to = Math.min(runs.length, from + Math.max(0, Math.floor(count)))
    const total = Math.max(0, to - from)
    let loaded = 0
    if (total === 0) return { loaded: 0, results }

    // Fast path for no in-memory hydration: keep existing read behavior.
    if (!opts?.hydrateInMemory) {
      let currentResults = results
      for (let i = from; i < to; i += 1) {
        const out = await loadOptimizationRun(currentResults, i)
        if (!out.run) continue
        loaded += 1
        currentResults = out.results
      }
      return { loaded, results: currentResults }
    }

    // Hydration path: patch runs in place to avoid deep cloning huge results payloads.
    const nextRuns = (results as unknown as { runs?: unknown[] } | null)?.runs
    if (!Array.isArray(nextRuns) || nextRuns.length === 0) return { loaded: 0, results }

    const chunkSize = Math.max(1, Math.floor(opts?.chunkSize ?? 40))
    const sampleRowCountLimit = 20
    let sampledRows = 0
    let sampledBytes = 0
    let lastEmittedLoaded = -1

    for (let chunkStart = from; chunkStart < to; chunkStart += chunkSize) {
      const chunkEnd = Math.min(to, chunkStart + chunkSize)
      const chunk = nextRuns.slice(chunkStart, chunkEnd)
      let chunkMutated = false

      for (let offset = 0; offset < chunk.length; offset += 1) {
        const i = chunkStart + offset
        const runRaw = chunk[offset]
        if (!isLazyRunRecord(runRaw)) {
          loaded += 1
          continue
        }

        const path = runRaw.path
        try {
          const hydrated = await deps.readJson<StoredOptimizationRunRecord>(path)
          chunk[offset] = hydrated as unknown as OptimizationRunRecord
          chunkMutated = true
          loaded += 1
          if (sampledRows < sampleRowCountLimit) {
            sampledRows += 1
            sampledBytes += estimateRunBytesFast(hydrated)
          }
        } catch (e) {
          console.warn('Failed to lazy-load optimization run', { index: i, path, error: e })
        }
      }

      if (chunkMutated) {
        nextRuns.splice(chunkStart, chunk.length, ...chunk)
      }

      if (opts?.onProgress) {
        const avgRowBytes = sampledRows > 0 ? sampledBytes / sampledRows : 0
        lastEmittedLoaded = loaded
        opts.onProgress({
          loaded,
          total,
          estimatedBytes: Math.round(avgRowBytes * loaded),
        })
      }

      if (chunkEnd < to) {
        await yieldToMainThread()
      }
    }

    if (opts?.onProgress && lastEmittedLoaded !== loaded) {
      const avgRowBytes = sampledRows > 0 ? sampledBytes / sampledRows : 0
      opts.onProgress({
        loaded,
        total,
        estimatedBytes: Math.round(avgRowBytes * loaded),
      })
    }

    return { loaded, results }
  }

  const readRunManifest = async (
    projectId: string,
    problemId: string,
    startedAtMs: number | null,
  ): Promise<PersistedRunManifestV1 | null> => {
    const path = runManifestPathFor(projectId, problemId, startedAtMs)
    try {
      const value = await deps.readJson<unknown>(path)
      if (!value || typeof value !== 'object') return null
      const rec = value as Record<string, unknown>
      if (rec.version !== 1 || !Array.isArray(rec.rows)) return null
      return rec as PersistedRunManifestV1
    } catch {
      return null
    }
  }

  return {
    runArchivePathForIndex,
    runManifestPathFor,
    optimizationResultsSnapshotPathFor,
    persistOptimizationResultsSnapshot,
    readOptimizationResultsSnapshot,
    readRunManifest,
    loadOptimizationRun,
    loadOptimizationRunsRange,
    buildLazyRunsFromSnapshot,
    cache: optimizationResultsSnapshotCache,
  }
}
