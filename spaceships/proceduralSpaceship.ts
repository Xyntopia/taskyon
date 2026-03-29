import { SPACESHIP_IDENTICON_VERSION } from './proceduralSpaceshipVersion.js'
import defaultLibraryData from './default_library.json' with { type: 'json' }
import {
  spaceshipLibrarySchema,
  type CategoryRequirementMap,
  type CellValue,
  type ExpandedSpaceshipModule,
  type ExistingOverlapByCategory,
  type ExistingOverlapConfig,
  type GridSizeConfig,
  type ModuleCategory,
  type PatternMatrix,
  type Placement,
  type RewindPolicy,
  type RenderSpaceshipSvgOptions,
  type StagesConfig,
  type SpaceshipAlgorithmConfig,
  type SpaceshipLibraryFile,
  type SpaceshipModuleDefinition,
  type SpaceshipScene,
  type SpaceshipSvgVariantDefinition,
  type StageSelectionMode,
  type SvgTransformConfig,
} from './spaceshipSchemas'

export const UNSET = -2 as const
export const IGNORE = -1 as const
export const SPACE = 0 as const
export const HULL = 1 as const
export const THRUSTER = 2 as const
export const COCKPIT = 3 as const
export const WING = 4 as const
export const STAY_AWAY = -3 as const

type NormalizedSpaceshipAlgorithmConfig = {
  symmetry: boolean
  stages: Record<number, NormalizedStageConfig>
  gridSize: GridSizeConfig
  identiconSize: number
  randomSvgColors: boolean
  showBackground: boolean
  showStars: boolean
}

type NormalizedStageConfig = {
  selection: StageSelectionMode
  useVariantWeights: boolean
  categories: Record<string, { min: number; max: number }>
}

export function sanitizeModuleSvgMarkup(rawSvg: string | undefined) {
  if (typeof rawSvg !== 'string') return rawSvg
  const stripped = rawSvg
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!doctype[\s\S]*?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim()
  const svgMatch = stripped.match(/<svg\b[^>]*>([\s\S]*?)<\/svg>/i)
  const content = (svgMatch?.[1] ?? stripped)
    .replace(/<\s*(metadata|title|desc|script|style)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/\s+transform\s*=\s*(".*?"|'.*?')/gi, '')
    .replace(/<\/?svg\b[^>]*>/gi, '')
    .trim()
  return content
}

type Grid = PatternMatrix

type BoundingBox = {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

type MaterialPalette = {
  c1: string
  c2: string
  c3: string
  c4: string
  hull: string
  hullAccent: string
  hullStroke: string
  window: string
  windowGlow: string
  wing: string
  thruster: string
  thrusterGlow: string
}

type Fit = {
  overlapCount: number
  overlapByCategory: Record<string, number>
  overlapSolidCount: number
  introducesNew: number
  frontierContacts: number
  overlapCells: Array<{ x: number; y: number }>
}

type PlacementRejectionReason =
  | 'outside-bounds'
  | 'blocking-cell'
  | 'cell-type-mismatch'
  | 'overlap-cell-disallowed'
  | 'existing-overlap-disallowed'
  | 'overlap-square'
  | 'no-new-cells'
  | 'no-support'
  | 'existing-overlap-allow-ignore-rule'
  | 'existing-overlap-no-ignore-rule'

type PlacementCandidate = {
  tile: ExpandedSpaceshipModule
  ox: number
  oy: number
  score: number
}

type SampledStageConfig = {
  selection: StageSelectionMode
  useVariantWeights: boolean
  categories: CategoryRequirementMap
}

type StageDeficitEntry = {
  category: string
  requested: number
  placed: number
  deficit: number
}

type StageStopReason =
  | 'requirements-satisfied'
  | 'no-tiles-for-deficit-categories'
  | 'no-candidates-for-deficit-categories'
  | 'attempt-limit-reached'

type StageEnforcementReport = {
  stopReason: StageStopReason
  finalDeficits: StageDeficitEntry[]
  blockedCategories: string[]
  attempts: number
  maxAttempts: number
  backtracks: number
  searchNodes: number
  useVariantWeights: boolean
  fellBackToGreedy: boolean
  stuckAtPlacementCount: number
  candidateDiagnostics: Array<{
    category: string
    requested: number
    placed: number
    tileCount: number
    candidateCount: number
    attemptedCandidates: number
    testedPositions?: number
    rejectionReasons?: Partial<Record<PlacementRejectionReason, number>>
  }>
}

type SceneGenerationSnapshot = {
  grid: Grid
  placements: Placement[]
  usage: Record<string, number>
}

type CreateSpaceshipSceneOptions = Pick<
  RenderSpaceshipSvgOptions,
  | 'moduleLibrary'
  | 'symmetry'
  | 'stages'
  | 'gridSize'
  | 'maxIntraStageBacktracks'
  | 'rewindPolicy'
  | 'stagnationRepeatThreshold'
  | 'preferDeeperRewindOnRepeat'
> & {
  debugGeneration?: boolean
  maxGlobalRewinds?: number
}

export const DEFAULT_GLOBAL_MAX_REWINDS = 2
export const DEFAULT_MAX_INTRA_STAGE_BACKTRACKS = 2
export const DEFAULT_REWIND_POLICY: RewindPolicy = 'quality-first'
export const DEFAULT_STAGNATION_REPEAT_THRESHOLD = 1

type CellBehavior = {
  paints: boolean
  matchable: boolean
  visible: boolean
  blocking: boolean
  allowOutsideBounds: boolean
  contributesToBounds: boolean
  connects: boolean
}

type CellDefinition = CellBehavior & {
  value: CellValue
  label: string
  className: string
  palette: boolean
}

type NormalizedExistingOverlap = ExistingOverlapByCategory

type NormalizedSvgTransformConfig = {
  offsetX: number
  offsetY: number
  scaleX: number
  scaleY: number
}

type PixelBounds = {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

const MIN_ICON_FILL_RATIO = 0.9
const SVG_NS = 'http://www.w3.org/2000/svg'

export const MODULE_CELL_TYPES = {
  ignore: IGNORE,
  space: SPACE,
  hull: HULL,
  thruster: THRUSTER,
  cockpit: COCKPIT,
  wing: WING,
  stayAway: STAY_AWAY,
} as const

export const CELL_DEFINITIONS = [
  {
    value: UNSET,
    label: 'unset',
    className: 'cell-unset',
    palette: false,
    paints: false,
    matchable: false,
    visible: false,
    blocking: false,
    allowOutsideBounds: false,
    contributesToBounds: false,
    connects: false,
  },
  {
    value: IGNORE,
    label: 'ignore',
    className: 'cell-ignore',
    palette: true,
    paints: false,
    matchable: false,
    visible: false,
    blocking: false,
    allowOutsideBounds: true,
    contributesToBounds: false,
    connects: false,
  },
  {
    value: SPACE,
    label: 'space',
    className: 'cell-space',
    palette: true,
    paints: true,
    matchable: true,
    visible: false,
    blocking: false,
    allowOutsideBounds: false,
    contributesToBounds: false,
    connects: false,
  },
  {
    value: HULL,
    label: 'hull',
    className: 'cell-hull',
    palette: true,
    paints: true,
    matchable: true,
    visible: true,
    blocking: false,
    allowOutsideBounds: false,
    contributesToBounds: true,
    connects: true,
  },
  {
    value: THRUSTER,
    label: 'thruster',
    className: 'cell-thruster',
    palette: true,
    paints: true,
    matchable: true,
    visible: true,
    blocking: false,
    allowOutsideBounds: false,
    contributesToBounds: true,
    connects: true,
  },
  {
    value: COCKPIT,
    label: 'cockpit',
    className: 'cell-cockpit',
    palette: true,
    paints: true,
    matchable: true,
    visible: true,
    blocking: false,
    allowOutsideBounds: false,
    contributesToBounds: true,
    connects: true,
  },
  {
    value: WING,
    label: 'wing',
    className: 'cell-wing',
    palette: true,
    paints: true,
    matchable: true,
    visible: true,
    blocking: false,
    allowOutsideBounds: false,
    contributesToBounds: true,
    connects: true,
  },
  {
    value: STAY_AWAY,
    label: 'stay-away',
    className: 'cell-stay-away',
    palette: true,
    paints: true,
    matchable: false,
    visible: false,
    blocking: true,
    allowOutsideBounds: true,
    contributesToBounds: false,
    connects: false,
  },
] as const satisfies readonly CellDefinition[]

export const CELL_FLAGS = Object.fromEntries(
  CELL_DEFINITIONS.map(({ value, ...flags }) => [value, flags]),
) as Record<CellValue, Omit<CellDefinition, 'value'>>

export const MODULE_CELL_PALETTE = CELL_DEFINITIONS.filter((entry) => entry.palette).map(
  ({ value, label, className }) => ({ value, label, className }),
)

export const SPACESHIP_SEED_COMPONENTS = {
  palettes: ['nova', 'ion', 'ember', 'void', 'signal', 'prism'],
  frames: ['hauler', 'spear', 'disk', 'orbiter', 'runner', 'array'],
  crews: ['atlas', 'lyra', 'orion', 'vega', 'draco', 'ursa'],
  missions: ['survey', 'cargo', 'escort', 'relay', 'patrol', 'rescue'],
} as const

function hullSvg(w: number, h: number) {
  return `<rect x="1.5" y="1.5" width="${w - 3}" height="${h - 3}" rx="8" fill="#e9edf5"/><path d="M 8 10 H ${Math.max(10, w - 10)}" stroke="#ffffff" stroke-opacity="0.42" stroke-width="1.4"/><path d="M 6 ${Math.max(12, h - 8)} H ${Math.max(12, w - 6)}" stroke="#c9d2e6" stroke-opacity="0.65" stroke-width="1"/>`
}

const CELL_SIZE = 18

function resolveDefaultLibrary() {
  const parsed = spaceshipLibrarySchema.parse(defaultLibraryData)
  const moduleCatalog = parsed.moduleCatalog
  const algorithm = toInternalAlgorithmConfig(parsed.algorithm)
  return {
    library: parsed,
    moduleCatalog: cloneModuleLibraryRaw(moduleCatalog),
    algorithm,
  }
}

function toInternalAlgorithmConfig(input: SpaceshipAlgorithmConfig): NormalizedSpaceshipAlgorithmConfig {
  return {
    symmetry: input.symmetry,
    stages: toInternalStages(input.stages),
    gridSize: {
      width: input.gridSize.width,
      height: input.gridSize.height,
    },
    identiconSize: input.identiconSize,
    randomSvgColors: input.randomSvgColors,
    showBackground: input.showBackground,
    showStars: input.showStars,
  }
}

function cloneModuleLibraryRaw(moduleLibrary: SpaceshipModuleDefinition[]) {
  return moduleLibrary.map(cloneModule)
}

const RESOLVED_DEFAULT_LIBRARY = resolveDefaultLibrary()
export const DEFAULT_SPACESHIP_LIBRARY: SpaceshipLibraryFile = structuredClone(
  RESOLVED_DEFAULT_LIBRARY.library,
)
export const DEFAULT_MODULE_LIBRARY: SpaceshipModuleDefinition[] =
  RESOLVED_DEFAULT_LIBRARY.moduleCatalog
export const DEFAULT_LIBRARY_ALGORITHM: NormalizedSpaceshipAlgorithmConfig =
  RESOLVED_DEFAULT_LIBRARY.algorithm

export function cloneModuleLibrary(
  moduleLibrary: SpaceshipModuleDefinition[] = DEFAULT_MODULE_LIBRARY,
): SpaceshipModuleDefinition[] {
  return cloneModuleLibraryRaw(moduleLibrary)
}

export function cloneModule(module: SpaceshipModuleDefinition): SpaceshipModuleDefinition {
  const cloned: SpaceshipModuleDefinition = {
    ...module,
    rotations: [...(module.rotations ?? [0])],
    pattern: clonePattern(module.pattern),
    svgVariants: cloneModuleSvgVariants(module.svgVariants),
  }
  if (module.existingOverlapAllowIgnore != null) {
    cloned.existingOverlapAllowIgnore = {
      ...normalizeExistingOverlap(module.existingOverlapAllowIgnore),
    }
  }
  if (module.existingOverlapNoIgnore != null) {
    cloned.existingOverlapNoIgnore = {
      ...normalizeExistingOverlap(module.existingOverlapNoIgnore),
    }
  }
  return cloned
}

export function cloneAlgorithmConfig(
  algorithm: SpaceshipAlgorithmConfig = DEFAULT_LIBRARY_ALGORITHM,
): NormalizedSpaceshipAlgorithmConfig {
  const sanitized = toInternalAlgorithmConfig(algorithm)
  return {
    ...sanitized,
    stages: Object.fromEntries(
      Object.entries(sanitized.stages).map(([stage, config]) => [
        stage,
        {
          selection: config.selection,
          useVariantWeights: config.useVariantWeights,
          categories: { ...config.categories },
        },
      ]),
    ),
    gridSize: {
      width: sanitized.gridSize.width,
      height: sanitized.gridSize.height,
    },
  }
}

export function createEmptyPattern(width = 5, height = 5, fill: CellValue = SPACE): PatternMatrix {
  return Array.from({ length: height }, () => Array<CellValue>(width).fill(fill))
}

export function resizePattern(
  pattern: PatternMatrix,
  width: number,
  height: number,
  fill: CellValue = SPACE,
): PatternMatrix {
  return Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => pattern[y]?.[x] ?? fill),
  )
}

export function createModuleCatalogEntry(index: number): SpaceshipModuleDefinition {
  return {
    id: `module_${index.toString().padStart(3, '0')}`,
    pattern: createEmptyPattern(),
    rotations: [0],
    description: '',
    allowRotation: true,
    svgVariants: {
      primary: {
        category: 'hull',
        svgMarkup: hullSvg(CELL_SIZE * 5, CELL_SIZE * 5),
      },
    },
  }
}

export function createSpaceshipScene(
  seedText: string,
  options: CreateSpaceshipSceneOptions = {},
): SpaceshipScene {
  const normalizedSeed = normalizeSeed(seedText)
  const moduleLibrary = cloneModuleLibrary(options.moduleLibrary ?? DEFAULT_MODULE_LIBRARY)
  const effectiveAlgorithm = toInternalAlgorithmConfig({
    ...DEFAULT_LIBRARY_ALGORITHM,
    ...(options.symmetry !== undefined ? { symmetry: options.symmetry } : {}),
    ...(options.stages !== undefined ? { stages: options.stages } : {}),
    ...(options.gridSize !== undefined ? { gridSize: options.gridSize } : {}),
  })
  const expandedTiles = expandTiles(moduleLibrary)
  const symmetry = effectiveAlgorithm.symmetry
  const stages = effectiveAlgorithm.stages
  const gridSize = effectiveAlgorithm.gridSize
  const rng = makeRng(normalizedSeed)
  const grid = createGrid(gridSize.width, gridSize.height)
  const placements: Placement[] = []
  const usage = {}
  const stageReports: NonNullable<SpaceshipScene['debug']>['stageReports'] = []

  const sampledStageRequirements = sampleStageRequirements(stages, rng)
  const sortedStages = Object.keys(sampledStageRequirements)
    .map(Number)
    .sort((a, b) => a - b)
  const globalMaxRewinds = Math.max(0, Math.floor(options.maxGlobalRewinds ?? DEFAULT_GLOBAL_MAX_REWINDS))
  const maxIntraStageBacktracks = Math.max(
    0,
    Math.floor(options.maxIntraStageBacktracks ?? DEFAULT_MAX_INTRA_STAGE_BACKTRACKS),
  )
  const rewindPolicy = options.rewindPolicy ?? DEFAULT_REWIND_POLICY
  const stagnationRepeatThreshold = Math.max(
    1,
    Math.floor(options.stagnationRepeatThreshold ?? DEFAULT_STAGNATION_REPEAT_THRESHOLD),
  )
  const preferDeeperRewindOnRepeat = options.preferDeeperRewindOnRepeat ?? true
  let globalRewindsUsed = 0
  const stageSnapshots = new Map<number, SceneGenerationSnapshot>()
  let stageReportsByStage = new Map<number, NonNullable<SpaceshipScene['debug']>['stageReports'][number]>()
  const crossStageRewindsByStage = new Map<number, number>()
  const stageRunCountByStage = new Map<number, number>()
  const duplicateInputByStage = new Map<number, number>()
  const lastRewindTargetByStage = new Map<number, number | null>()
  const seenInputHashesByStage = new Map<number, Set<string>>()
  type SceneQuality = {
    isComplete: boolean
    unresolvedDeficits: number
    satisfiedStages: number
    placementCount: number
    rewindsUsed: number
  }
  let bestSnapshot: SceneGenerationSnapshot | null = null
  let bestQuality: SceneQuality | null = null
  let bestReportsByStage:
    | Map<number, NonNullable<SpaceshipScene['debug']>['stageReports'][number]>
    | null = null
  let restoredBestCandidate = false

  const cloneStageReport = (
    report: NonNullable<SpaceshipScene['debug']>['stageReports'][number],
  ): NonNullable<SpaceshipScene['debug']>['stageReports'][number] => ({
    ...report,
    requestedByCategory: { ...report.requestedByCategory },
    finalDeficits: report.finalDeficits.map((entry) => ({ ...entry })),
    blockedCategories: [...report.blockedCategories],
    candidateDiagnostics: (report.candidateDiagnostics ?? []).map((entry) => ({
      ...entry,
      ...(entry.rejectionReasons ? { rejectionReasons: { ...entry.rejectionReasons } } : {}),
    })),
    addedModules: (report.addedModules ?? []).map((entry) => ({ ...entry })),
  })
  const cloneStageReportMap = (
    reports: Map<number, NonNullable<SpaceshipScene['debug']>['stageReports'][number]>,
  ) =>
    new Map(
      [...reports.entries()].map(([stage, report]) => [
        stage,
        cloneStageReport(report),
      ]),
    )
  const setStageReportFields = (
    stage: number,
    fields: Partial<NonNullable<SpaceshipScene['debug']>['stageReports'][number]>,
  ) => {
    const current = stageReportsByStage.get(stage)
    if (!current) return
    stageReportsByStage.set(stage, { ...current, ...fields })
  }
  const evaluateSceneQuality = (activePlacements: Placement[], rewindsUsed: number): SceneQuality => {
    let unresolvedDeficits = 0
    let satisfiedStages = 0
    sortedStages.forEach((stage) => {
      const config = sampledStageRequirements[stage]
      if (!config) return
      let stageSatisfied = true
      Object.entries(config.categories).forEach(([category, requested]) => {
        const placed = countPlacementsForCategory(activePlacements, category)
        const deficit = Math.max(0, requested - placed)
        if (deficit > 0) stageSatisfied = false
        unresolvedDeficits += deficit
      })
      if (stageSatisfied) satisfiedStages += 1
    })
    return {
      isComplete: unresolvedDeficits === 0 && satisfiedStages === sortedStages.length,
      unresolvedDeficits,
      satisfiedStages,
      placementCount: activePlacements.length,
      rewindsUsed,
    }
  }
  const isBetterQuality = (next: SceneQuality, current: SceneQuality | null) => {
    if (!current) return true
    if (next.isComplete !== current.isComplete) return next.isComplete
    if (next.unresolvedDeficits !== current.unresolvedDeficits)
      return next.unresolvedDeficits < current.unresolvedDeficits
    if (next.satisfiedStages !== current.satisfiedStages) return next.satisfiedStages > current.satisfiedStages
    if (next.placementCount !== current.placementCount) return next.placementCount > current.placementCount
    return next.rewindsUsed < current.rewindsUsed
  }
  const maybeCaptureBestSnapshot = () => {
    if (rewindPolicy !== 'quality-first') return
    const nextQuality = evaluateSceneQuality(placements, globalRewindsUsed)
    if (!isBetterQuality(nextQuality, bestQuality)) return
    bestQuality = nextQuality
    bestSnapshot = createSceneSnapshot(grid, placements, usage)
    bestReportsByStage = options.debugGeneration ? cloneStageReportMap(stageReportsByStage) : null
  }

  sortedStages.forEach((stage) => {
    const config = sampledStageRequirements[stage]
    if (!config) return
    crossStageRewindsByStage.set(stage, 0)
    stageRunCountByStage.set(stage, 0)
    duplicateInputByStage.set(stage, 0)
    lastRewindTargetByStage.set(stage, null)
    seenInputHashesByStage.set(stage, new Set<string>())
  })

  let stageIndex = 0
  const maxStageIterations = Math.max(
    sortedStages.length * 2 + 8,
    sortedStages.length + globalMaxRewinds + 8,
  )
  let stageIterations = 0
  while (stageIndex < sortedStages.length && stageIterations < maxStageIterations) {
    stageIterations += 1
    const stage = sortedStages[stageIndex] as number
    const stageConfig = sampledStageRequirements[stage]
    const requiredByCategory = stageConfig?.categories ?? {}
    if (!Object.keys(requiredByCategory).length || !stageConfig) {
      stageIndex += 1
      continue
    }

    const currentInputHash = buildSceneStateHash(placements, usage)
    const seenHashes = seenInputHashesByStage.get(stage) ?? new Set<string>()
    const duplicateInputState = seenHashes.has(currentInputHash)
    if (duplicateInputState) {
      duplicateInputByStage.set(stage, (duplicateInputByStage.get(stage) ?? 0) + 1)
    } else {
      seenHashes.add(currentInputHash)
      seenInputHashesByStage.set(stage, seenHashes)
    }

    const stageHasActionableWorkAtSnapshot = (snapshotStageIndex: number) => {
      const snapshotStage = sortedStages[snapshotStageIndex]
      const snapshotConfig = snapshotStage !== undefined ? sampledStageRequirements[snapshotStage] : undefined
      const snapshot = stageSnapshots.get(snapshotStageIndex)
      if (snapshotStage === undefined || !snapshotConfig || !snapshot) return false
      return Object.entries(snapshotConfig.categories).some(([category, requested]) => {
        const placed = countPlacementsForCategory(snapshot.placements, category)
        return placed < requested
      })
    }

    const findRewindTargetIndex = (currentStageIndex: number, preferDeeper: boolean) => {
      if (currentStageIndex <= 0) return -1
      const preferredStart = preferDeeper
        ? Math.max(0, currentStageIndex - 2)
        : currentStageIndex - 1
      for (let candidateIndex = preferredStart; candidateIndex >= 0; candidateIndex -= 1) {
        if (stageSnapshots.has(candidateIndex) && stageHasActionableWorkAtSnapshot(candidateIndex)) {
          return candidateIndex
        }
      }
      for (let candidateIndex = currentStageIndex - 1; candidateIndex >= 0; candidateIndex -= 1) {
        if (stageSnapshots.has(candidateIndex) && stageHasActionableWorkAtSnapshot(candidateIndex)) {
          return candidateIndex
        }
      }
      return -1
    }

    stageSnapshots.set(stageIndex, createSceneSnapshot(grid, placements, usage))
    const runCount = (stageRunCountByStage.get(stage) ?? 0) + 1
    stageRunCountByStage.set(stage, runCount)
    const explorationPass = rewindPolicy === 'strict-deterministic' ? 0 : runCount - 1
    const placementsBeforeStage = placements.length
    const report = enforceCategoryRequirements(
      grid,
      rng,
      usage,
      placements,
      expandedTiles,
      symmetry,
      requiredByCategory,
      stageConfig.selection,
      stageConfig.useVariantWeights,
      maxIntraStageBacktracks,
      explorationPass,
    )
    const stageAddedModules = placements.slice(placementsBeforeStage).map((placement) => ({
      moduleId: placement.tile.id,
      variantId: placement.tile.variantId,
      category: placement.tile.category,
      x: placement.x,
      y: placement.y,
    }))
    if (options.debugGeneration) {
      stageReportsByStage.set(stage, {
        stage,
        selectionMode: stageConfig.selection,
        useVariantWeights: stageConfig.useVariantWeights,
        globalMaxRewinds: maxIntraStageBacktracks,
        requestedByCategory: { ...requiredByCategory },
        finalDeficits: report.finalDeficits.map((entry) => ({ ...entry })),
        blockedCategories: [...report.blockedCategories],
        attempts: report.attempts,
        maxAttempts: report.maxAttempts,
        backtracks: report.backtracks,
        searchNodes: report.searchNodes,
        fellBackToGreedy: report.fellBackToGreedy,
        stuckAtPlacementCount: report.stuckAtPlacementCount,
        candidateDiagnostics: report.candidateDiagnostics.map((entry) => ({ ...entry })),
        crossStageRewinds: crossStageRewindsByStage.get(stage) ?? 0,
        stageRunCount: runCount,
        duplicateInputStates: duplicateInputByStage.get(stage) ?? 0,
        lastRewindTargetStage: lastRewindTargetByStage.get(stage) ?? null,
        rewindStrategyUsed: 'none',
        rewindDepth: 0,
        stagnationDetected: false,
        bestCandidateKept: false,
        addedPlacementCount: stageAddedModules.length,
        addedModules: stageAddedModules,
        stopReason: report.stopReason,
      })
    }
    maybeCaptureBestSnapshot()

    const stageSatisfied =
      report.stopReason === 'requirements-satisfied' && report.finalDeficits.length === 0
    if (stageSatisfied) {
      stageIndex += 1
      continue
    }

    const duplicateInputs = duplicateInputByStage.get(stage) ?? 0
    const stagnationDetected = duplicateInputs >= stagnationRepeatThreshold
    const canRewindToPreviousStage = stageIndex > 0 && globalRewindsUsed < globalMaxRewinds
    if (canRewindToPreviousStage) {
      const preferDeeperTarget =
        rewindPolicy === 'quality-first' &&
        preferDeeperRewindOnRepeat &&
        stagnationDetected
      let targetIndex = findRewindTargetIndex(stageIndex, preferDeeperTarget)
      let rewindStrategy: 'nearest' | 'deeper' = preferDeeperTarget ? 'deeper' : 'nearest'
      if (targetIndex < 0 && rewindStrategy === 'deeper') {
        targetIndex = findRewindTargetIndex(stageIndex, false)
        rewindStrategy = 'nearest'
      }
      if (targetIndex < 0) {
        setStageReportFields(stage, {
          rewindStrategyUsed: 'none',
          rewindDepth: 0,
          stagnationDetected,
        })
        stageIndex += 1
        continue
      }
      globalRewindsUsed += 1
      crossStageRewindsByStage.set(stage, (crossStageRewindsByStage.get(stage) ?? 0) + 1)
      const targetStage = sortedStages[targetIndex] as number
      lastRewindTargetByStage.set(stage, targetStage)
      setStageReportFields(stage, {
        rewindStrategyUsed: rewindStrategy,
        rewindDepth: Math.max(0, stage - targetStage),
        stagnationDetected,
      })
      const previousSnapshot = stageSnapshots.get(targetIndex)
      if (previousSnapshot) {
        restoreSceneSnapshot(previousSnapshot, grid, placements, usage)
      }
      const pruneFrom = sortedStages[targetIndex] as number
      sortedStages
        .filter((candidateStage) => candidateStage >= pruneFrom)
        .forEach((candidateStage) => stageReportsByStage.delete(candidateStage))
      stageIndex = targetIndex
      continue
    }

    setStageReportFields(stage, {
      rewindStrategyUsed: 'none',
      rewindDepth: 0,
      stagnationDetected,
    })
    stageIndex += 1
  }
  maybeCaptureBestSnapshot()
  if (rewindPolicy === 'quality-first' && bestSnapshot && bestQuality) {
    const finalQuality = evaluateSceneQuality(placements, globalRewindsUsed)
    if (isBetterQuality(bestQuality, finalQuality)) {
      restoreSceneSnapshot(bestSnapshot, grid, placements, usage)
      restoredBestCandidate = true
      if (options.debugGeneration && bestReportsByStage) {
        stageReportsByStage = cloneStageReportMap(bestReportsByStage)
      }
    }
  }
  if (options.debugGeneration) {
    if (restoredBestCandidate) {
      stageReportsByStage.forEach((report, stage) => {
        stageReportsByStage.set(stage, { ...report, bestCandidateKept: true })
      })
    }
    sortedStages.forEach((stage) => {
      const report = stageReportsByStage.get(stage)
      if (report) stageReports.push(report)
    })
  }
  const totalRequestedPlacements = Object.values(sampledStageRequirements).reduce(
    (sum, stageConfig) =>
      sum + Object.values(stageConfig.categories).reduce((acc, count) => acc + count, 0),
    0,
  )
  fillUnsetWithSpace(grid)
  const bbox = findBoundingBox(grid, (value) => value !== UNSET && contributesToBounds(value))
  const gridWidth = grid[0]?.length ?? 0

  const unresolvedCategories = stageReports.flatMap((report) =>
    report.finalDeficits.map((entry) => ({
      stage: report.stage,
      category: entry.category,
      requested: entry.requested,
      placed: entry.placed,
      deficit: entry.deficit,
    })),
  )

  return {
    version: SPACESHIP_IDENTICON_VERSION,
    seedText: normalizedSeed,
    symmetry,
    gridSize: { width: gridWidth, height: grid.length },
    grid: clonePattern(grid),
    placements: placements.map((placement) => ({
      x: placement.x,
      y: placement.y,
      overlapCells: placement.overlapCells.map((cell) => ({ ...cell })),
      tile: {
        ...placement.tile,
        pattern: clonePattern(placement.tile.pattern),
        rotations: [...placement.tile.rotations],
      },
    })),
    moduleLibrarySnapshot: moduleLibrary,
    usage: { ...usage },
    stats: {
      hullCells: countCells(grid, HULL),
      cockpitCells: countCells(grid, COCKPIT),
      thrusterCells: countCells(grid, THRUSTER),
      wingCells: countCells(grid, WING),
      moduleCount: placements.length,
      occupiedBounds: bbox,
    },
    summary: {
      symmetryLabel: symmetry ? 'mirrored' : 'freeform',
      moduleCountLabel: `${placements.length} modules (${totalRequestedPlacements} requested)`,
    },
    ...(options.debugGeneration
      ? {
          debug: {
            stageReports,
            unresolvedCategories,
          },
        }
      : {}),
  }
}

export function renderSpaceshipSvg(
  seedText: string,
  options: RenderSpaceshipSvgOptions = {},
): string {
  const algorithmDefaults = DEFAULT_LIBRARY_ALGORITHM
  const scene = createSpaceshipScene(seedText, {
    ...(options.moduleLibrary ? { moduleLibrary: options.moduleLibrary } : {}),
    ...(options.symmetry !== undefined ? { symmetry: options.symmetry } : {}),
    ...(options.stages !== undefined ? { stages: options.stages } : {}),
    ...(options.gridSize !== undefined ? { gridSize: options.gridSize } : {}),
    ...(options.maxGlobalRewinds !== undefined
      ? { maxGlobalRewinds: options.maxGlobalRewinds }
      : {}),
    ...(options.maxIntraStageBacktracks !== undefined
      ? { maxIntraStageBacktracks: options.maxIntraStageBacktracks }
      : {}),
    ...(options.rewindPolicy !== undefined ? { rewindPolicy: options.rewindPolicy } : {}),
    ...(options.stagnationRepeatThreshold !== undefined
      ? { stagnationRepeatThreshold: options.stagnationRepeatThreshold }
      : {}),
    ...(options.preferDeeperRewindOnRepeat !== undefined
      ? { preferDeeperRewindOnRepeat: options.preferDeeperRewindOnRepeat }
      : {}),
  })
  const requestedSize =
    options.size != null && Number.isFinite(options.size)
      ? Math.max(1, Math.floor(options.size))
      : algorithmDefaults.identiconSize

  return buildSvg(scene.grid, scene.placements, {
    size: requestedSize,
    showBackground: options.showBackground ?? algorithmDefaults.showBackground,
    backgroundFill: options.backgroundFill ?? 'rgba(6, 14, 24, 0.92)',
    showStars: options.showStars ?? algorithmDefaults.showStars,
    debugBounds: options.debugBounds ?? false,
    seedText: scene.seedText,
    randomSvgColors: options.randomSvgColors ?? algorithmDefaults.randomSvgColors,
    ...(options.focusedModuleId ? { focusedModuleId: options.focusedModuleId } : {}),
  })
}

function normalizeSeed(seedText: string) {
  return seedText.trim() || 'untitled'
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function xmur3(str: string) {
  let h = 1779033703 ^ str.length
  for (let i = 0; i < str.length; i += 1) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  return function next() {
    h = Math.imul(h ^ (h >>> 16), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    return (h ^= h >>> 16) >>> 0
  }
}

function sfc32(a: number, b: number, c: number, d: number) {
  return function next() {
    a >>>= 0
    b >>>= 0
    c >>>= 0
    d >>>= 0
    let t = (a + b) | 0
    a = b ^ (b >>> 9)
    b = (c + (c << 3)) | 0
    c = (c << 21) | (c >>> 11)
    d = (d + 1) | 0
    t = (t + d) | 0
    c = (c + t) | 0
    return (t >>> 0) / 4294967296
  }
}

function makeRng(seed: string) {
  const h = xmur3(seed)
  return sfc32(h(), h(), h(), h())
}

function rotatePattern(pattern: PatternMatrix): PatternMatrix {
  const h = pattern.length
  const w = pattern[0]?.length ?? 0
  const out = Array.from({ length: w }, () => Array<CellValue>(h).fill(IGNORE))
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      out[x]![h - 1 - y] = pattern[y]![x]!
    }
  }
  return out
}

function clonePattern(pattern: PatternMatrix): PatternMatrix {
  return pattern.map((row) => [...row])
}

function cloneModuleSvgVariants(
  svgVariants: Record<string, SpaceshipSvgVariantDefinition> | undefined,
): Record<string, SpaceshipSvgVariantDefinition> {
  const cloned: Record<string, SpaceshipSvgVariantDefinition> = {}
  for (const [name, variant] of Object.entries(svgVariants ?? {})) {
    const key = name.trim()
    if (!key || !variant) continue
    const next: SpaceshipSvgVariantDefinition = {
      category: variant.category,
    }
    if (variant.weight != null) next.weight = normalizeVariantWeight(variant.weight, 1)
    if (variant.zIndex != null) next.zIndex = normalizeZIndex(variant.zIndex, 0)
    if (variant.description != null) next.description = variant.description
    if (variant.svgMarkup != null) next.svgMarkup = sanitizeModuleSvgMarkup(variant.svgMarkup) ?? ''
    if (variant.transform) {
      const transform: SvgTransformConfig = {}
      if (variant.transform.offsetX != null)
        transform.offsetX = normalizeSvgOffset(variant.transform.offsetX, 0)
      if (variant.transform.offsetY != null)
        transform.offsetY = normalizeSvgOffset(variant.transform.offsetY, 0)
      if (variant.transform.scaleX != null)
        transform.scaleX = normalizeSvgScale(variant.transform.scaleX, 1)
      if (variant.transform.scaleY != null)
        transform.scaleY = normalizeSvgScale(variant.transform.scaleY, 1)
      if (Object.keys(transform).length > 0) next.transform = transform
    }
    cloned[key] = next
  }
  return cloned
}

function expandTiles(moduleLibrary: SpaceshipModuleDefinition[]): ExpandedSpaceshipModule[] {
  const out: ExpandedSpaceshipModule[] = []

  for (const sourceModule of moduleLibrary) {
    const source = cloneModule(sourceModule)
    const base = normalizeModule(source)
    const svgVariants = resolveModuleSvgVariants(source)
    const unique = new Set<string>()
    let current = clonePattern(base.pattern)
    for (const rotation of base.rotations) {
      current = clonePattern(base.pattern)
      for (let step = 0; step < rotation; step += 1) current = rotatePattern(current)
      const key = JSON.stringify(current)
      if (unique.has(key)) continue
      unique.add(key)
      for (const svgVariant of svgVariants) {
        out.push({
          ...base,
          category: svgVariant.category,
          svgVariantWeight: svgVariant.weight,
          svgMarkup: svgVariant.markup,
          svgVariantName: svgVariant.name,
          svgTransform: svgVariant.transform,
          svgOffsetX: svgVariant.transform.offsetX,
          svgOffsetY: svgVariant.transform.offsetY,
          svgScaleX: svgVariant.transform.scaleX,
          svgScaleY: svgVariant.transform.scaleY,
          zIndex: svgVariant.zIndex,
          pattern: clonePattern(current),
          rotation,
          variantId: `${base.id}@${rotation}#${svgVariant.name}`,
        })
      }
    }
  }

  return out
}

function resolveModuleSvgVariants(module: Pick<SpaceshipModuleDefinition, 'svgVariants'>) {
  const entries = Object.entries(module.svgVariants ?? {})
    .map(([name, variant]) => {
      const key = name.trim()
      if (!key || !variant) return null
      return {
        name: key,
        category: variant.category,
        weight: normalizeVariantWeight(variant.weight, 1),
        zIndex: normalizeZIndex(variant.zIndex, 0),
        markup: sanitizeModuleSvgMarkup(variant.svgMarkup) ?? '',
        transform: normalizeSvgTransformConfig(variant.transform),
        description: variant.description ?? '',
      }
    })
    .filter(
      (
        entry,
      ): entry is {
        name: string
        category: ModuleCategory
        weight: number
        zIndex: number
        markup: string
        transform: NormalizedSvgTransformConfig
        description: string
      } => entry != null,
    )
  if (!entries.length) {
    entries.push({
      name: 'primary',
      category: 'hull',
      weight: 1,
      zIndex: 0,
      markup: '',
      transform: normalizeSvgTransformConfig(undefined),
      description: '',
    })
  }
  return entries
}

function toInternalStages(input: StagesConfig): Record<number, NormalizedStageConfig> {
  const entries = Object.entries(input)
    .map(([stageKey, stageConfig]) => [
      Number(stageKey),
      {
        selection: stageConfig.selection,
        useVariantWeights: stageConfig.useVariantWeights ?? false,
        categories: Object.fromEntries(
          Object.entries(stageConfig.categories).map(([category, countSpec]) => [
            category,
            toStageCategoryRange(countSpec),
          ]),
        ),
      },
    ] as const)
    .sort((a, b) => a[0] - b[0])
  return Object.fromEntries(entries)
}

function toStageCategoryRange(value: number | { min: number; max: number }) {
  if (typeof value === 'number') return { min: value, max: value }
  return { min: value.min, max: value.max }
}

function randomIntInclusive(min: number, max: number, rng: () => number) {
  if (max <= min) return min
  return min + Math.floor(rng() * (max - min + 1))
}

function sampleStageRequirements(
  stages: Record<number, NormalizedStageConfig>,
  rng: () => number,
): Record<number, SampledStageConfig> {
  const sampled: Record<number, SampledStageConfig> = {}
  for (const [stageKey, stageConfig] of Object.entries(stages)) {
    const stage = Number(stageKey)
    if (!Number.isFinite(stage)) continue
    const requirements: CategoryRequirementMap = {}
    for (const [category, range] of Object.entries(stageConfig.categories)) {
      const count = randomIntInclusive(range.min, range.max, rng)
      if (count > 0) requirements[category] = count
    }
    if (Object.keys(requirements).length > 0) {
      sampled[stage] = {
        selection: stageConfig.selection,
        useVariantWeights: stageConfig.useVariantWeights,
        categories: requirements,
      }
    }
  }
  return sampled
}

function normalizeOverlapCount(value: unknown, fallback = 1) {
  const normalized = Math.max(0, Math.floor(Number(value)))
  return Number.isFinite(normalized) ? normalized : fallback
}

function normalizeOverlapByCategory(
  value: unknown,
  fallback: ExistingOverlapByCategory = {},
): ExistingOverlapByCategory {
  if (!value || typeof value !== 'object') return { ...fallback }
  const source = value as Record<string, unknown>
  const normalized: ExistingOverlapByCategory = {}
  Object.entries(source).forEach(([category, value]) => {
    const key = `${category}`.trim()
    if (!key) return
    const count = normalizeOverlapCount(value, 0)
    if (count > 0) normalized[key] = count
  })
  return normalized
}

function normalizeExistingOverlap(
  value: ExistingOverlapConfig | undefined,
  fallback: NormalizedExistingOverlap = {},
): NormalizedExistingOverlap {
  if (typeof value === 'number') return { ...fallback }
  if (!value || typeof value !== 'object') return { ...fallback }

  const source = value as Record<string, unknown>
  const hasEnvelope =
    Object.prototype.hasOwnProperty.call(source, 'total') ||
    Object.prototype.hasOwnProperty.call(source, 'byCategory')
  return hasEnvelope
    ? normalizeOverlapByCategory(source.byCategory, fallback)
    : normalizeOverlapByCategory(source, fallback)
}

function overlapCategoryForCell(value: CellValue): ModuleCategory | null {
  if (value === SPACE) return 'space'
  if (value === HULL) return 'hull'
  if (value === THRUSTER) return 'thruster'
  if (value === COCKPIT) return 'cockpit'
  if (value === WING) return 'wing'
  return null
}

function normalizeSvgScale(value: unknown, fallback = 1) {
  if (!Number.isFinite(Number(value))) return Math.max(0.05, fallback)
  return Math.max(0.05, Number(value))
}

function normalizeSvgOffset(value: unknown, fallback = 0) {
  if (!Number.isFinite(Number(value))) return fallback
  return Number(value)
}

function normalizeVariantWeight(value: unknown, fallback = 1) {
  if (!Number.isFinite(Number(value))) return Math.max(0, fallback)
  return Math.max(0, Number(value))
}

function normalizeZIndex(value: unknown, fallback = 0) {
  if (!Number.isFinite(Number(value))) return fallback
  return Number(value)
}

function normalizeSvgTransformConfig(
  transform: SvgTransformConfig | undefined,
  fallback: NormalizedSvgTransformConfig = { offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 },
): NormalizedSvgTransformConfig {
  return {
    offsetX: normalizeSvgOffset(transform?.offsetX, fallback.offsetX),
    offsetY: normalizeSvgOffset(transform?.offsetY, fallback.offsetY),
    scaleX: normalizeSvgScale(transform?.scaleX, fallback.scaleX),
    scaleY: normalizeSvgScale(transform?.scaleY, fallback.scaleY),
  }
}

function createZeroOverlapByCategory(): Record<string, number> {
  return {
    hull: 0,
    cockpit: 0,
    thruster: 0,
    wing: 0,
    space: 0,
  }
}

function meetsOverlapRequirements(
  overlapByCategory: Record<string, number>,
  rules: NormalizedExistingOverlap,
) {
  return Object.entries(rules).every(([category, required]) => {
    if (required == null) return true
    return (overlapByCategory[category] ?? 0) >= required
  })
}

function normalizeModule(module: SpaceshipModuleDefinition): ExpandedSpaceshipModule {
  const normalizedVariants = cloneModuleSvgVariants(module.svgVariants)
  const firstVariantName = Object.keys(normalizedVariants)[0] ?? 'primary'
  const firstVariant = normalizedVariants[firstVariantName] ?? { category: 'hull' as const }
  const firstVariantTransform = normalizeSvgTransformConfig(firstVariant.transform)
  return {
    id: module.id,
    pattern: clonePattern(module.pattern),
    existingOverlapAllowIgnore: normalizeExistingOverlap(module.existingOverlapAllowIgnore),
    existingOverlapNoIgnore: normalizeExistingOverlap(module.existingOverlapNoIgnore),
    rotations: module.allowRotation === false ? [0] : [...(module.rotations ?? [0])],
    maxCount: module.maxCount ?? Number.POSITIVE_INFINITY,
    category: firstVariant.category,
    svgVariantWeight: normalizeVariantWeight(firstVariant.weight, 1),
    svgMarkup: sanitizeModuleSvgMarkup(firstVariant.svgMarkup) ?? '',
    svgVariantName: firstVariantName,
    svgTransform: firstVariantTransform,
    svgOffsetX: firstVariantTransform.offsetX,
    svgOffsetY: firstVariantTransform.offsetY,
    svgScaleX: firstVariantTransform.scaleX,
    svgScaleY: firstVariantTransform.scaleY,
    zIndex: normalizeZIndex(firstVariant.zIndex, 0),
    allowRotation: module.allowRotation ?? true,
    description: module.description ?? '',
    rotation: 0,
    variantId: `${module.id}@0`,
  }
}

function createGrid(width: number, height: number, fill: CellValue = UNSET): Grid {
  return Array.from({ length: height }, () => Array<CellValue>(width).fill(fill))
}

function gridBounds(grid: Grid) {
  return { width: grid[0]?.length ?? 0, height: grid.length }
}

function getTileDimensions(tile: Pick<ExpandedSpaceshipModule, 'pattern'>) {
  return { width: tile.pattern[0]?.length ?? 0, height: tile.pattern.length }
}

function getCellFlags(value: CellValue): CellBehavior {
  return CELL_FLAGS[value]
}

function isPaintedCell(value: CellValue) {
  return getCellFlags(value).paints
}

function isMatchableCell(value: CellValue) {
  return getCellFlags(value).matchable
}

function isVisibleShipCell(value: CellValue) {
  return getCellFlags(value).visible
}

function isBlockingCell(value: CellValue) {
  return getCellFlags(value).blocking
}

function allowsOutsideBounds(value: CellValue) {
  return getCellFlags(value).allowOutsideBounds
}

function contributesToBounds(value: CellValue) {
  return getCellFlags(value).contributesToBounds
}

function connectsToHull(value: CellValue) {
  return getCellFlags(value).connects
}

function isBorderCell(pattern: PatternMatrix, x: number, y: number) {
  const width = pattern[0]?.length ?? 0
  const height = pattern.length
  return x === 0 || y === 0 || x === width - 1 || y === height - 1
}

function hasIgnoreNeighbor(pattern: PatternMatrix, x: number, y: number) {
  const neighbors: Array<readonly [number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]
  return neighbors.some(([dx, dy]) => pattern[y + dy]?.[x + dx] === IGNORE)
}

function overlapCellAllowed(pattern: PatternMatrix, x: number, y: number) {
  return isBorderCell(pattern, x, y) || hasIgnoreNeighbor(pattern, x, y)
}

function existingOverlapAllows(placements: Placement[], gx: number, gy: number) {
  const coveringPlacements = placements.filter((placement) => {
    const lx = gx - placement.x
    const ly = gy - placement.y
    return (
      ly >= 0 &&
      ly < placement.tile.pattern.length &&
      lx >= 0 &&
      lx < (placement.tile.pattern[0]?.length ?? 0) &&
      isPaintedCell(placement.tile.pattern[ly]?.[lx] as CellValue)
    )
  })

  if (!coveringPlacements.length) return true
  return coveringPlacements.every((placement) => {
    const lx = gx - placement.x
    const ly = gy - placement.y
    return overlapCellAllowed(placement.tile.pattern, lx, ly)
  })
}

function hasOverlapSquare(overlapCells: Array<{ x: number; y: number }>) {
  const occupied = new Set(overlapCells.map(({ x, y }) => `${x},${y}`))
  for (const { x, y } of overlapCells) {
    if (
      occupied.has(`${x + 1},${y}`) &&
      occupied.has(`${x},${y + 1}`) &&
      occupied.has(`${x + 1},${y + 1}`)
    ) {
      return true
    }
  }
  return false
}

function mirrorXForPlacement(
  grid: Grid,
  tile: Pick<ExpandedSpaceshipModule, 'pattern'>,
  ox: number,
) {
  const { width } = gridBounds(grid)
  const tileWidth = tile.pattern[0]?.length ?? 0
  return width - tileWidth - ox
}

function wouldMirrorDuplicate(
  tile: Pick<ExpandedSpaceshipModule, 'pattern'>,
  ox: number,
  mirrorX: number,
) {
  const tileWidth = tile.pattern[0]?.length ?? 0
  return mirrorX === ox || (mirrorX < ox + tileWidth && ox < mirrorX + tileWidth)
}

function paintedArea(pattern: PatternMatrix) {
  let count = 0
  for (const row of pattern) for (const value of row) if (isPaintedCell(value)) count += 1
  return count
}

function getHullNeighbors(grid: Grid, x: number, y: number) {
  let count = 0
  if (grid[y - 1]?.[x] != null && connectsToHull(grid[y - 1]![x]!)) count += 1
  if (grid[y + 1]?.[x] != null && connectsToHull(grid[y + 1]![x]!)) count += 1
  if (grid[y]?.[x - 1] != null && connectsToHull(grid[y][x - 1]!)) count += 1
  if (grid[y]?.[x + 1] != null && connectsToHull(grid[y][x + 1]!)) count += 1
  return count
}

function canPlaceTile(
  grid: Grid,
  tile: ExpandedSpaceshipModule,
  ox: number,
  oy: number,
  placements: Placement[] = [],
  enforceOverlapRequirements = true,
): Fit | null {
  return evaluateTileFit(grid, tile, ox, oy, placements, enforceOverlapRequirements).fit
}

function evaluateTileFit(
  grid: Grid,
  tile: ExpandedSpaceshipModule,
  ox: number,
  oy: number,
  placements: Placement[] = [],
  enforceOverlapRequirements = true,
): { fit: Fit | null; reason?: PlacementRejectionReason } {
  const { width, height } = gridBounds(grid)
  const { width: tw, height: th } = getTileDimensions(tile)

  let overlapCount = 0
  const overlapByCategoryAllowIgnore = createZeroOverlapByCategory()
  const overlapByCategoryNoIgnore = createZeroOverlapByCategory()
  let overlapSolidCount = 0
  let paintsSomething = 0
  let introducesNew = 0
  let frontierContacts = 0
  const overlapCells: Array<{ x: number; y: number }> = []

  for (let y = 0; y < th; y += 1) {
    for (let x = 0; x < tw; x += 1) {
      const value = tile.pattern[y]![x]!
      const gx = ox + x
      const gy = oy + y
      const inside = gx >= 0 && gy >= 0 && gx < width && gy < height

      if (!inside) {
        if (!isPaintedCell(value) || allowsOutsideBounds(value)) continue
        return { fit: null, reason: 'outside-bounds' }
      }

      const current = grid[gy]![gx]!
      if (value === IGNORE && current !== UNSET) {
        const overlapCategory = overlapCategoryForCell(current)
        if (overlapCategory)
          overlapByCategoryAllowIgnore[overlapCategory] = (overlapByCategoryAllowIgnore[overlapCategory] ?? 0) + 1
        overlapCount += 1
        overlapCells.push({ x: gx, y: gy })
      }
      if (!isPaintedCell(value)) continue

      paintsSomething += 1

      if (current !== UNSET) {
        if (isBlockingCell(current) || isBlockingCell(value)) return { fit: null, reason: 'blocking-cell' }
        if (!isMatchableCell(current) || !isMatchableCell(value)) return { fit: null, reason: 'cell-type-mismatch' }
        if (current !== value) return { fit: null, reason: 'cell-type-mismatch' }
        if (!overlapCellAllowed(tile.pattern, x, y)) return { fit: null, reason: 'overlap-cell-disallowed' }
        if (!existingOverlapAllows(placements, gx, gy)) return { fit: null, reason: 'existing-overlap-disallowed' }
        overlapCount += 1
        const overlapCategory = overlapCategoryForCell(current)
        if (overlapCategory) {
          overlapByCategoryAllowIgnore[overlapCategory] =
            (overlapByCategoryAllowIgnore[overlapCategory] ?? 0) + 1
          overlapByCategoryNoIgnore[overlapCategory] = (overlapByCategoryNoIgnore[overlapCategory] ?? 0) + 1
        }
        overlapCells.push({ x: gx, y: gy })
        if (isVisibleShipCell(value)) overlapSolidCount += 1
      } else {
        introducesNew += 1
        if (connectsToHull(value)) frontierContacts += getHullNeighbors(grid, gx, gy)
      }
    }
  }

  if (hasOverlapSquare(overlapCells)) return { fit: null, reason: 'overlap-square' }
  if (paintsSomething === 0 || introducesNew === 0) return { fit: null, reason: 'no-new-cells' }
  const hasAnyPlacedPixels = grid.some((row) => row.some((value) => value !== UNSET))
  // Existing overlap is also a valid structural support, not only frontier contact.
  if (hasAnyPlacedPixels && frontierContacts <= 0 && overlapCount <= 0) {
    return { fit: null, reason: 'no-support' }
  }
  const effectiveAllowIgnore = normalizeExistingOverlap(tile.existingOverlapAllowIgnore)
  const effectiveNoIgnore = normalizeExistingOverlap(tile.existingOverlapNoIgnore)
  if (
    hasAnyPlacedPixels &&
    enforceOverlapRequirements &&
    !meetsOverlapRequirements(overlapByCategoryAllowIgnore, effectiveAllowIgnore)
  ) {
    return { fit: null, reason: 'existing-overlap-allow-ignore-rule' }
  }
  if (
    hasAnyPlacedPixels &&
    enforceOverlapRequirements &&
    !meetsOverlapRequirements(overlapByCategoryNoIgnore, effectiveNoIgnore)
  ) {
    return { fit: null, reason: 'existing-overlap-no-ignore-rule' }
  }
  return {
    fit: {
      overlapCount,
      overlapByCategory: overlapByCategoryAllowIgnore,
      overlapSolidCount,
      introducesNew,
      frontierContacts,
      overlapCells,
    },
  }
}

function applyTile(grid: Grid, tile: ExpandedSpaceshipModule, ox: number, oy: number) {
  const { width, height } = getTileDimensions(tile)
  const bounds = gridBounds(grid)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = tile.pattern[y]![x]!
      if (!isPaintedCell(value)) continue
      const gx = ox + x
      const gy = oy + y
      if (gx < 0 || gy < 0 || gx >= bounds.width || gy >= bounds.height) continue
      grid[gy]![gx] = value
    }
  }
}

function clonePlacements(placements: Placement[]) {
  return placements.map((placement) => ({
    tile: placement.tile,
    x: placement.x,
    y: placement.y,
    overlapCells: placement.overlapCells.map((cell) => ({ ...cell })),
  }))
}

function replaceGrid(target: Grid, next: Grid) {
  target.splice(0, target.length, ...next.map((row) => [...row]))
}

function replacePlacements(target: Placement[], next: Placement[]) {
  target.splice(0, target.length, ...clonePlacements(next))
}

function replaceUsage(target: Record<string, number>, next: Record<string, number>) {
  for (const key of Object.keys(target)) delete target[key]
  Object.entries(next).forEach(([key, value]) => {
    target[key] = value
  })
}

function createSceneSnapshot(
  grid: Grid,
  placements: Placement[],
  usage: Record<string, number>,
): SceneGenerationSnapshot {
  return {
    grid: clonePattern(grid),
    placements: clonePlacements(placements),
    usage: { ...usage },
  }
}

function restoreSceneSnapshot(
  snapshot: SceneGenerationSnapshot,
  grid: Grid,
  placements: Placement[],
  usage: Record<string, number>,
) {
  replaceGrid(grid, snapshot.grid)
  replacePlacements(placements, snapshot.placements)
  replaceUsage(usage, snapshot.usage)
}

function buildSceneStateHash(placements: Placement[], usage: Record<string, number>) {
  const placementKey = placements
    .map((placement) => `${placement.tile.variantId}@${placement.x},${placement.y}`)
    .sort()
    .join('|')
  const usageKey = Object.entries(usage)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, value]) => `${key}:${value}`)
    .join('|')
  return `${placementKey}#${usageKey}`
}

function countComponents(grid: Grid) {
  const seen = new Set<string>()
  const directions: Array<readonly [number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]
  let components = 0

  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < (grid[0]?.length ?? 0); x += 1) {
      const value = grid[y]![x]!
      if (value === UNSET || !connectsToHull(value)) continue
      const key = `${x},${y}`
      if (seen.has(key)) continue
      components += 1
      const stack: Array<[number, number]> = [[x, y]]
      seen.add(key)
      while (stack.length) {
        const [cx, cy] = stack.pop()!
        for (const [dx, dy] of directions) {
          const nx = cx + dx
          const ny = cy + dy
          if (ny < 0 || ny >= grid.length || nx < 0 || nx >= (grid[0]?.length ?? 0)) continue
          const next = grid[ny]![nx]!
          if (next === UNSET || !connectsToHull(next)) continue
          const nextKey = `${nx},${ny}`
          if (seen.has(nextKey)) continue
          seen.add(nextKey)
          stack.push([nx, ny])
        }
      }
    }
  }

  return components
}

function scorePlacement(
  tile: ExpandedSpaceshipModule,
  ox: number,
  oy: number,
  fit: Fit,
  grid: Grid,
  symmetry: boolean,
) {
  const centerX = (grid[0]?.length ?? 0) / 2
  const tileWidth = tile.pattern[0]?.length ?? 0
  const tileCenter = ox + tileWidth / 2
  const centerBias = 1 / (1 + Math.abs(tileCenter - centerX))
  const areaBias = paintedArea(tile.pattern) * 0.35
  const overlapBias = fit.overlapCount * 2.4
  const frontierBias = fit.frontierContacts * 0.8
  const symmetryBias = symmetry ? 1.25 : 1
  return Math.max(0.1, areaBias + overlapBias + frontierBias + centerBias * symmetryBias)
}

function findPlacements(
  grid: Grid,
  tiles: ExpandedSpaceshipModule[],
  usage: Record<string, number>,
  symmetry: boolean,
  existingPlacements: Placement[],
) {
  const placements: PlacementCandidate[] = []
  const rejectionReasons: Partial<Record<PlacementRejectionReason, number>> = {}
  let testedPositions = 0
  const { width, height } = gridBounds(grid)

  for (const tile of tiles) {
    if ((usage[tile.id] ?? 0) >= tile.maxCount) continue
    const { width: tw, height: th } = getTileDimensions(tile)
    for (let oy = -th + 1; oy < height; oy += 1) {
      for (let ox = -tw + 1; ox < width; ox += 1) {
        testedPositions += 1
        const evaluation = evaluateTileFit(grid, tile, ox, oy, existingPlacements)
        const fit = evaluation.fit
        if (!fit && evaluation.reason) {
          rejectionReasons[evaluation.reason] = (rejectionReasons[evaluation.reason] ?? 0) + 1
        }
        if (!fit || fit.introducesNew <= 0) continue
        const mirrorBonus =
          symmetry && !wouldMirrorDuplicate(tile, ox, mirrorXForPlacement(grid, tile, ox))
            ? 1.08
            : 1
        placements.push({
          tile,
          ox,
          oy,
          score: scorePlacement(tile, ox, oy, fit, grid, symmetry) * mirrorBonus,
        })
      }
    }
  }

  return {
    placements,
    testedPositions,
    rejectionReasons,
  }
}

function placeTileWithOptionalMirror(
  grid: Grid,
  tile: ExpandedSpaceshipModule,
  ox: number,
  oy: number,
  placements: Placement[],
  symmetry: boolean,
) {
  let count = 0
  const fit = canPlaceTile(grid, tile, ox, oy, placements)
  if (!fit) return count
  applyTile(grid, tile, ox, oy)
  placements.push({ tile, x: ox, y: oy, overlapCells: fit.overlapCells })
  count += 1
  if (!symmetry) return count

  const mirrorX = mirrorXForPlacement(grid, tile, ox)
  if (wouldMirrorDuplicate(tile, ox, mirrorX)) return count
  const mirrorFit = canPlaceTile(grid, tile, mirrorX, oy, placements)
  if (!mirrorFit) return count
  applyTile(grid, tile, mirrorX, oy)
  placements.push({ tile, x: mirrorX, y: oy, overlapCells: mirrorFit.overlapCells })
  count += 1
  return count
}

function fillUnsetWithSpace(grid: Grid) {
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < (grid[0]?.length ?? 0); x += 1) {
      if (grid[y]![x] === UNSET) grid[y]![x] = SPACE
    }
  }
}

function enforceCategoryRequirements(
  grid: Grid,
  rng: () => number,
  usage: Record<string, number>,
  placements: Placement[],
  allTiles: ExpandedSpaceshipModule[],
  symmetry: boolean,
  requiredCategories: CategoryRequirementMap,
  selectionMode: StageSelectionMode,
  useVariantWeights: boolean,
  maxRewindSteps: number,
  explorationPass: number,
): StageEnforcementReport {
  const categories = Object.keys(requiredCategories).filter(
    (category) => Math.max(0, requiredCategories[category] ?? 0) > 0,
  )
  if (!categories.length) {
    return {
      stopReason: 'requirements-satisfied' as const,
      finalDeficits: [],
      blockedCategories: [],
      attempts: 0,
      maxAttempts: 0,
      backtracks: 0,
      searchNodes: 0,
      useVariantWeights,
      fellBackToGreedy: false,
      stuckAtPlacementCount: placements.length,
      candidateDiagnostics: [],
    }
  }

  const tilesByCategory = new Map<string, ExpandedSpaceshipModule[]>()
  categories.forEach((category) => {
    tilesByCategory.set(
      category,
      allTiles.filter((tile) => tile.category === category),
    )
  })

  const { width, height } = gridBounds(grid)
  const maxAttempts = Math.max(192, width * height * Math.max(6, categories.length * 3))
  let attempts = 0
  let backtracks = 0
  let searchNodes = 0
  type MutableState = {
    grid: Grid
    placements: Placement[]
    usage: Record<string, number>
  }
  type DecisionPoint = {
    snapshot: MutableState
    remainingCandidates: PlacementCandidate[]
  }

  const state: MutableState = {
    grid: clonePattern(grid),
    placements: clonePlacements(placements),
    usage: { ...usage },
  }
  const decisionStack: DecisionPoint[] = []
  let lastBlockedCategories: string[] = []
  let lastMissingTilesForAllDeficits = false
  let lastCandidateDiagnostics: StageEnforcementReport['candidateDiagnostics'] = []

  const computeDeficits = (activePlacements: Placement[]) =>
    categories
      .map((category) => {
        const requested = Math.max(0, requiredCategories[category] ?? 0)
        const placed = countPlacementsForCategory(activePlacements, category)
        return {
          category,
          requested,
          placed,
          deficit: Math.max(0, requested - placed),
        }
      })
      .filter((entry) => entry.deficit > 0)
      .sort((a, b) => b.deficit - a.deficit || a.category.localeCompare(b.category))

  const cloneState = (source: MutableState): MutableState => {
    return {
      grid: clonePattern(source.grid),
      placements: clonePlacements(source.placements),
      usage: { ...source.usage },
    }
  }

  while (attempts < maxAttempts) {
    const deficits = computeDeficits(state.placements)
    if (!deficits.length) {
      replaceGrid(grid, state.grid)
      replacePlacements(placements, state.placements)
      replaceUsage(usage, state.usage)
      return {
        stopReason: 'requirements-satisfied',
        finalDeficits: [],
        blockedCategories: [],
        attempts,
        maxAttempts,
        backtracks,
        searchNodes,
        useVariantWeights,
        fellBackToGreedy: false,
        stuckAtPlacementCount: state.placements.length,
        candidateDiagnostics: lastCandidateDiagnostics,
      }
    }

    let placedAny = false
    const blockedCategories: string[] = []
    let missingTilesForAllDeficits = true
    const candidateDiagnostics: StageEnforcementReport['candidateDiagnostics'] = []
    for (const { category } of deficits) {
      const requested = Math.max(0, requiredCategories[category] ?? 0)
      const alreadyPlaced = countPlacementsForCategory(state.placements, category)
      const tiles = tilesByCategory.get(category) ?? []
      if (!tiles.length) {
        blockedCategories.push(category)
        candidateDiagnostics.push({
          category,
          requested,
          placed: alreadyPlaced,
          tileCount: 0,
          candidateCount: 0,
          attemptedCandidates: 0,
        })
        continue
      }
      missingTilesForAllDeficits = false
      const placementSearch = findPlacements(state.grid, tiles, state.usage, symmetry, state.placements)
      const candidates = placementSearch.placements
      if (!candidates.length) {
        blockedCategories.push(category)
        candidateDiagnostics.push({
          category,
          requested,
          placed: alreadyPlaced,
          tileCount: tiles.length,
          candidateCount: 0,
          attemptedCandidates: 0,
          testedPositions: placementSearch.testedPositions,
          rejectionReasons: { ...placementSearch.rejectionReasons },
        })
        continue
      }
      const orderedCandidates = orderCandidatesForSearch(
        candidates,
        rng,
        selectionMode,
        useVariantWeights,
        explorationPass,
      )
      const snapshot = cloneState(state)
      let attemptedCandidates = 0
      for (let index = 0; index < orderedCandidates.length; index += 1) {
        const candidate = orderedCandidates[index] as PlacementCandidate
        attempts += 1
        searchNodes += 1
        attemptedCandidates += 1
        const addedCount = placeTileWithOptionalMirror(
          state.grid,
          candidate.tile,
          candidate.ox,
          candidate.oy,
          state.placements,
          symmetry,
        )
        if (addedCount === 0) continue
        state.usage[candidate.tile.id] = (state.usage[candidate.tile.id] ?? 0) + 1
        const remainingCandidates = orderedCandidates.slice(index + 1)
        if (remainingCandidates.length > 0) {
          decisionStack.push({
            snapshot,
            remainingCandidates,
          })
        }
        candidateDiagnostics.push({
          category,
          requested,
          placed: alreadyPlaced,
          tileCount: tiles.length,
          candidateCount: candidates.length,
          attemptedCandidates,
          testedPositions: placementSearch.testedPositions,
          rejectionReasons: { ...placementSearch.rejectionReasons },
        })
        placedAny = true
        break
      }
      if (placedAny) break
      candidateDiagnostics.push({
        category,
        requested,
        placed: alreadyPlaced,
        tileCount: tiles.length,
        candidateCount: candidates.length,
        attemptedCandidates,
        testedPositions: placementSearch.testedPositions,
        rejectionReasons: { ...placementSearch.rejectionReasons },
      })
      blockedCategories.push(category)
    }

    if (placedAny) {
      lastCandidateDiagnostics = candidateDiagnostics
      continue
    }
    lastBlockedCategories = blockedCategories
    lastMissingTilesForAllDeficits = missingTilesForAllDeficits
    lastCandidateDiagnostics = candidateDiagnostics

    let resumedFromBacktrack = false
    while (backtracks < maxRewindSteps && decisionStack.length > 0 && attempts < maxAttempts) {
      const decision = decisionStack.pop() as DecisionPoint
      backtracks += 1
      replaceGrid(state.grid, decision.snapshot.grid)
      replacePlacements(state.placements, decision.snapshot.placements)
      replaceUsage(state.usage, decision.snapshot.usage)

      while (decision.remainingCandidates.length > 0 && attempts < maxAttempts) {
        const candidate = decision.remainingCandidates.shift() as PlacementCandidate
        attempts += 1
        searchNodes += 1
        const addedCount = placeTileWithOptionalMirror(
          state.grid,
          candidate.tile,
          candidate.ox,
          candidate.oy,
          state.placements,
          symmetry,
        )
        if (addedCount === 0) continue
        state.usage[candidate.tile.id] = (state.usage[candidate.tile.id] ?? 0) + 1
        if (decision.remainingCandidates.length > 0) {
          decisionStack.push({
            snapshot: cloneState(decision.snapshot),
            remainingCandidates: [...decision.remainingCandidates],
          })
        }
        resumedFromBacktrack = true
        break
      }
      if (resumedFromBacktrack) break
    }
    if (resumedFromBacktrack) continue
    break
  }

  const finalDeficits = computeDeficits(state.placements)
  replaceGrid(grid, state.grid)
  replacePlacements(placements, state.placements)
  replaceUsage(usage, state.usage)
  return {
    stopReason: attempts >= maxAttempts
      ? 'attempt-limit-reached'
      : lastMissingTilesForAllDeficits
        ? 'no-tiles-for-deficit-categories'
        : 'no-candidates-for-deficit-categories',
    finalDeficits,
    blockedCategories: lastBlockedCategories,
    attempts,
    maxAttempts,
    backtracks,
    searchNodes,
    useVariantWeights,
    fellBackToGreedy: backtracks > 0,
    stuckAtPlacementCount: state.placements.length,
    candidateDiagnostics: lastCandidateDiagnostics,
  }
}

function orderCandidatesForSearch(
  candidates: PlacementCandidate[],
  rng: () => number,
  selectionMode: StageSelectionMode,
  useVariantWeights: boolean,
  explorationPass: number,
): PlacementCandidate[] {
  if (!candidates.length) return []
  if (selectionMode === 'scored') {
    const sorted = [...candidates].sort((a, b) => {
      const aScore = a.score * (useVariantWeights ? variantWeightForCandidate(a) : 1)
      const bScore = b.score * (useVariantWeights ? variantWeightForCandidate(b) : 1)
      if (bScore !== aScore) return bScore - aScore
      return comparePlacementCandidates(a, b)
    })
    return rotateCandidates(sorted, explorationPass)
  }
  if (selectionMode === 'weighted') {
    const weighted = candidates.map((candidate) => ({
      candidate,
      weight:
        Math.max(0.0001, candidate.score) * (useVariantWeights ? variantWeightForCandidate(candidate) : 1),
    }))
    const totalWeight = weighted.reduce((sum, entry) => sum + Math.max(0, entry.weight), 0)
    if (totalWeight <= 0) return rotateCandidates(shufflePlacementCandidates(candidates, rng), explorationPass)
    return rotateCandidates(weightedPermutation(weighted, rng), explorationPass)
  }
  if (!useVariantWeights) return rotateCandidates(shufflePlacementCandidates(candidates, rng), explorationPass)
  const weighted = candidates.map((candidate) => ({
    candidate,
    weight: variantWeightForCandidate(candidate),
  }))
  const totalWeight = weighted.reduce((sum, entry) => sum + Math.max(0, entry.weight), 0)
  if (totalWeight <= 0) return rotateCandidates(shufflePlacementCandidates(candidates, rng), explorationPass)
  return rotateCandidates(weightedPermutation(weighted, rng), explorationPass)
}

function rotateCandidates(candidates: PlacementCandidate[], offset: number) {
  if (!candidates.length) return []
  const normalized = Math.max(0, Math.floor(offset)) % candidates.length
  if (normalized === 0) return candidates
  return [...candidates.slice(normalized), ...candidates.slice(0, normalized)]
}

function variantWeightForCandidate(candidate: PlacementCandidate) {
  return normalizeVariantWeight(candidate.tile.svgVariantWeight, 1)
}

function comparePlacementCandidates(a: PlacementCandidate, b: PlacementCandidate) {
  if (a.ox !== b.ox) return a.ox - b.ox
  if (a.oy !== b.oy) return a.oy - b.oy
  if (a.tile.variantId !== b.tile.variantId) return a.tile.variantId.localeCompare(b.tile.variantId)
  return a.tile.id.localeCompare(b.tile.id)
}

function shufflePlacementCandidates(candidates: PlacementCandidate[], rng: () => number) {
  const shuffled = [...candidates]
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const swapIndex = Math.floor(rng() * (i + 1))
    const next = shuffled[i]
    shuffled[i] = shuffled[swapIndex] as PlacementCandidate
    shuffled[swapIndex] = next as PlacementCandidate
  }
  return shuffled
}

function weightedPermutation(
  weighted: Array<{ candidate: PlacementCandidate; weight: number }>,
  rng: () => number,
) {
  return [...weighted]
    .map((entry) => {
      const weight = Math.max(0, entry.weight)
      const randomUnit = Math.max(1e-12, rng())
      return {
        candidate: entry.candidate,
        rank: weight > 0 ? -Math.log(randomUnit) / weight : Number.POSITIVE_INFINITY,
      }
    })
    .sort((a, b) => a.rank - b.rank || comparePlacementCandidates(a.candidate, b.candidate))
    .map((entry) => entry.candidate)
}

function countPlacementsForCategory(placements: Placement[], category: string) {
  return placements.reduce(
    (count, placement) => count + (placement.tile.category === category ? 1 : 0),
    0,
  )
}

function findBoundingBox(grid: Grid, predicate: (value: CellValue) => boolean): BoundingBox | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < (grid[0]?.length ?? 0); x += 1) {
      if (!predicate(grid[y]![x]!)) continue
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  if (maxX < 0) return null
  return { minX, minY, maxX, maxY }
}

function countCells(grid: Grid, value: CellValue) {
  let total = 0
  for (const row of grid) for (const cell of row) if (cell === value) total += 1
  return total
}

function renderPlacedModuleSvg(
  tile: Placement['tile'],
  cellSize: number,
  materialPalette: MaterialPalette,
  randomSvgColors: boolean,
  scopeId: string,
) {
  const width = (tile.pattern[0]?.length ?? 0) * cellSize
  const height = tile.pattern.length * cellSize
  const normalizedRotation = ((tile.rotation % 4) + 4) % 4
  const baseWidth = normalizedRotation % 2 === 0 ? width : height
  const baseHeight = normalizedRotation % 2 === 0 ? height : width
  const centerX = baseWidth / 2
  const centerY = baseHeight / 2
  const trimmedMarkup = tile.svgMarkup.trim()
  const resolvedMarkup = applyMaterialPaletteToMarkup(trimmedMarkup, materialPalette)
  const scopedMarkup = scopeSvgDefinitionIds(resolvedMarkup, scopeId)
  const content = trimmedMarkup
    ? normalizeModuleSvgContent(
        scopedMarkup,
        baseWidth,
        baseHeight,
        cellSize,
        tile.svgScaleX,
        tile.svgScaleY,
        tile.svgOffsetX,
        tile.svgOffsetY,
      )
    : renderPatternRects(tile.pattern, cellSize)
  const colorizedContent = content

  if (!tile.svgMarkup.trim() || normalizedRotation === 0)
    return `<g class="module-svg">${colorizedContent}</g>`
  const angle = normalizedRotation * 90
  const rotatedBounds = rotateRectAroundCenter(baseWidth, baseHeight, normalizedRotation)
  const shiftX = -rotatedBounds.minX
  const shiftY = -rotatedBounds.minY
  return `<g class="module-svg" transform="translate(${shiftX} ${shiftY})"><g transform="rotate(${angle} ${centerX} ${centerY})">${colorizedContent}</g></g>`
}

function rotateRectAroundCenter(width: number, height: number, normalizedRotation: number) {
  if (normalizedRotation === 0) {
    return { minX: 0, minY: 0, maxX: width, maxY: height }
  }
  const cx = width / 2
  const cy = height / 2
  const radians = (normalizedRotation * Math.PI) / 2
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const corners = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: 0, y: height },
    { x: width, y: height },
  ].map(({ x, y }) => {
    const dx = x - cx
    const dy = y - cy
    return {
      x: cx + dx * cos - dy * sin,
      y: cy + dx * sin + dy * cos,
    }
  })
  const xs = corners.map((point) => point.x)
  const ys = corners.map((point) => point.y)
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  }
}

function normalizeModuleSvgContent(
  markup: string,
  fallbackWidth: number,
  fallbackHeight: number,
  cellSize: number,
  moduleScaleX = 1,
  moduleScaleY = 1,
  moduleOffsetX = 0,
  moduleOffsetY = 0,
) {
  const parsed = parseModuleSvgMarkup(markup, fallbackWidth, fallbackHeight)
  const ringInset = cellSize * 0.5
  const targetWidth = Math.max(1, fallbackWidth - ringInset * 2)
  const targetHeight = Math.max(1, fallbackHeight - ringInset * 2)
  const baseScaleX = targetWidth / Math.max(1, parsed.width)
  const baseScaleY = targetHeight / Math.max(1, parsed.height)
  const scaleX = baseScaleX * Math.max(0.05, moduleScaleX)
  const scaleY = baseScaleY * Math.max(0.05, moduleScaleY)
  const translateX = ringInset - parsed.minX * scaleX + moduleOffsetX * cellSize
  const translateY = ringInset - parsed.minY * scaleY + moduleOffsetY * cellSize
  return `<g transform="translate(${translateX} ${translateY}) scale(${scaleX} ${scaleY})">${parsed.content}</g>`
}

function parseModuleSvgMarkup(markup: string, fallbackWidth: number, fallbackHeight: number) {
  const trimmed = markup.trim()
  const svgMatch = trimmed.match(/<svg\b([^>]*)>([\s\S]*?)<\/svg>/i)
  const attrs = svgMatch?.[1] ?? ''
  const content = (svgMatch?.[2] ?? trimmed).trim()
  const viewBox = attrs.match(/viewBox\s*=\s*["']([^"']+)["']/i)?.[1]?.trim()
  const viewBoxParts = (viewBox ?? '')
    .split(/[\s,]+/)
    .map((entry) => Number(entry))
    .filter((entry) => Number.isFinite(entry))
  const width = Number(attrs.match(/width\s*=\s*["']([^"']+)["']/i)?.[1]?.replace(/px$/i, ''))
  const height = Number(attrs.match(/height\s*=\s*["']([^"']+)["']/i)?.[1]?.replace(/px$/i, ''))
  const hasViewBox = viewBoxParts.length >= 4
  const minX = hasViewBox ? viewBoxParts[0]! : 0
  const minY = hasViewBox ? viewBoxParts[1]! : 0
  const vbWidth = hasViewBox ? Math.abs(viewBoxParts[2]!) : Number.NaN
  const vbHeight = hasViewBox ? Math.abs(viewBoxParts[3]!) : Number.NaN

  return {
    content,
    minX,
    minY,
    width: Number.isFinite(vbWidth) ? vbWidth : Number.isFinite(width) ? width : fallbackWidth,
    height: Number.isFinite(vbHeight)
      ? vbHeight
      : Number.isFinite(height)
        ? height
        : fallbackHeight,
  }
}

function mergePixelBounds(a: PixelBounds | null, b: PixelBounds): PixelBounds {
  if (!a) return b
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  }
}

function rotatePixelBoundsAroundCenter(
  bounds: PixelBounds,
  centerX: number,
  centerY: number,
  radians: number,
): PixelBounds {
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const corners = [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.minX, y: bounds.maxY },
    { x: bounds.maxX, y: bounds.maxY },
  ].map(({ x, y }) => {
    const dx = x - centerX
    const dy = y - centerY
    return {
      x: centerX + dx * cos - dy * sin,
      y: centerY + dx * sin + dy * cos,
    }
  })
  return {
    minX: Math.min(...corners.map((point) => point.x)),
    minY: Math.min(...corners.map((point) => point.y)),
    maxX: Math.max(...corners.map((point) => point.x)),
    maxY: Math.max(...corners.map((point) => point.y)),
  }
}

function getPlacedModuleLocalVisualBounds(tile: Placement['tile'], cellSize: number): PixelBounds {
  const width = (tile.pattern[0]?.length ?? 0) * cellSize
  const height = tile.pattern.length * cellSize
  const moduleBounds: PixelBounds = { minX: 0, minY: 0, maxX: width, maxY: height }
  if (!tile.svgMarkup.trim()) return moduleBounds

  const normalizedRotation = ((tile.rotation % 4) + 4) % 4
  const baseWidth = normalizedRotation % 2 === 0 ? width : height
  const baseHeight = normalizedRotation % 2 === 0 ? height : width
  const parsed = parseModuleSvgMarkup(tile.svgMarkup, baseWidth, baseHeight)
  const ringInset = cellSize * 0.5
  const targetWidth = Math.max(1, baseWidth - ringInset * 2)
  const targetHeight = Math.max(1, baseHeight - ringInset * 2)
  const baseScaleX = targetWidth / Math.max(1, parsed.width)
  const baseScaleY = targetHeight / Math.max(1, parsed.height)
  const scaleX = baseScaleX * Math.max(0.05, tile.svgScaleX)
  const scaleY = baseScaleY * Math.max(0.05, tile.svgScaleY)
  const translateX = ringInset - parsed.minX * scaleX + tile.svgOffsetX * cellSize
  const translateY = ringInset - parsed.minY * scaleY + tile.svgOffsetY * cellSize
  const unrotatedBounds: PixelBounds = {
    minX: translateX + parsed.minX * scaleX,
    minY: translateY + parsed.minY * scaleY,
    maxX: translateX + (parsed.minX + parsed.width) * scaleX,
    maxY: translateY + (parsed.minY + parsed.height) * scaleY,
  }
  if (normalizedRotation === 0) return unrotatedBounds

  const centerX = baseWidth / 2
  const centerY = baseHeight / 2
  const rotated = rotatePixelBoundsAroundCenter(
    unrotatedBounds,
    centerX,
    centerY,
    (normalizedRotation * Math.PI) / 2,
  )
  const rotatedModule = rotateRectAroundCenter(baseWidth, baseHeight, normalizedRotation)
  const shiftX = -rotatedModule.minX
  const shiftY = -rotatedModule.minY
  return {
    minX: rotated.minX + shiftX,
    minY: rotated.minY + shiftY,
    maxX: rotated.maxX + shiftX,
    maxY: rotated.maxY + shiftY,
  }
}

function getPlacementVisualBounds(
  placement: Placement,
  cellSize: number,
  debugBounds: boolean,
  focusedModuleId?: string,
): PixelBounds {
  const { tile, x, y } = placement
  const tx = x * cellSize
  const ty = y * cellSize
  const local = getPlacedModuleLocalVisualBounds(tile, cellSize)
  let global: PixelBounds = {
    minX: local.minX + tx,
    minY: local.minY + ty,
    maxX: local.maxX + tx,
    maxY: local.maxY + ty,
  }
  const isFocused = focusedModuleId != null && tile.id === focusedModuleId
  if (debugBounds || isFocused) {
    const strokeInset = debugBounds ? 1.5 : 1
    global = {
      minX: global.minX - strokeInset,
      minY: global.minY - strokeInset,
      maxX: global.maxX + strokeInset,
      maxY: global.maxY + strokeInset,
    }
  }
  return global
}

function getSceneVisualBounds(
  placements: Placement[],
  cellSize: number,
  debugBounds: boolean,
  focusedModuleId?: string,
): PixelBounds | null {
  let bounds: PixelBounds | null = null
  for (const placement of placements) {
    bounds = mergePixelBounds(
      bounds,
      getPlacementVisualBounds(placement, cellSize, debugBounds, focusedModuleId),
    )
  }
  return bounds
}

function measureRenderedOverlayBounds(
  overlayMarkup: string,
  fallbackWidth: number,
  fallbackHeight: number,
): PixelBounds | null {
  if (typeof document === 'undefined' || !document.body || !overlayMarkup.trim()) return null
  try {
    const svg = document.createElementNS(SVG_NS, 'svg')
    svg.setAttribute('viewBox', `0 0 ${Math.max(1, fallbackWidth)} ${Math.max(1, fallbackHeight)}`)
    svg.setAttribute('width', `${Math.max(1, fallbackWidth)}`)
    svg.setAttribute('height', `${Math.max(1, fallbackHeight)}`)
    svg.setAttribute('aria-hidden', 'true')
    svg.style.position = 'absolute'
    svg.style.left = '-100000px'
    svg.style.top = '-100000px'
    svg.style.visibility = 'hidden'
    svg.style.pointerEvents = 'none'
    svg.style.overflow = 'visible'
    svg.innerHTML = `<g id="ship-overlay-bounds-root">${overlayMarkup}</g>`
    document.body.appendChild(svg)
    const root = svg.querySelector<SVGGElement>('#ship-overlay-bounds-root')
    const bbox = root?.getBBox()
    svg.remove()
    if (!bbox) return null
    if (!Number.isFinite(bbox.width) || !Number.isFinite(bbox.height)) return null
    if (bbox.width <= 0 || bbox.height <= 0) return null
    return {
      minX: bbox.x,
      minY: bbox.y,
      maxX: bbox.x + bbox.width,
      maxY: bbox.y + bbox.height,
    }
  } catch {
    return null
  }
}

function renderPlacedModules(
  placements: Placement[],
  cellSize: number,
  debugBounds: boolean,
  seedText: string,
  randomSvgColors = false,
  focusedModuleId?: string,
) {
  const materialPalette = createMaterialPalette(seedText, randomSvgColors)
  const ordered = placements
    .map((placement, originalIndex) => ({ placement, originalIndex }))
    .sort((a, b) => {
      const az = normalizeZIndex(a.placement.tile.zIndex, 0)
      const bz = normalizeZIndex(b.placement.tile.zIndex, 0)
      if (az !== bz) return az - bz
      return a.originalIndex - b.originalIndex
    })
  return ordered
    .map(({ placement, originalIndex }) => {
      const { tile, x, y, overlapCells } = placement
      const tx = x * cellSize
      const ty = y * cellSize
      const width = (tile.pattern[0]?.length ?? 0) * cellSize
      const height = tile.pattern.length * cellSize
      const isFocused = focusedModuleId != null && tile.id === focusedModuleId
      const focusedRing = isFocused
        ? `<rect x="0" y="0" width="${width}" height="${height}" fill="none" stroke="#ffd166" stroke-width="${debugBounds ? 2.6 : 2}" opacity="${debugBounds ? 0.95 : 0.78}"/>`
        : ''
      const bounds = debugBounds
        ? `<rect x="0" y="0" width="${width}" height="${height}" fill="none" stroke="${isFocused ? '#ffd166' : '#ff4d8d'}" stroke-width="${isFocused ? 2.4 : 1.2}" stroke-dasharray="4 3" opacity="0.95"/>`
        : ''
      const overlaps = debugBounds
        ? overlapCells
            .map(
              (cell) =>
                `<circle cx="${(cell.x - x + 0.5) * cellSize}" cy="${(cell.y - y + 0.5) * cellSize}" r="${cellSize * 0.16}" fill="#ff4d8d" opacity="0.95"/>`,
            )
            .join('')
        : ''
      const content = renderPlacedModuleSvg(
        tile,
        cellSize,
        materialPalette,
        randomSvgColors,
        buildPlacementScopeId(tile.id, x, y, originalIndex),
      )
      return `<g transform="translate(${tx} ${ty})">${content}${focusedRing}${bounds}${overlaps}</g>`
    })
    .join('')
}

function buildPlacementScopeId(moduleId: string, x: number, y: number, placementIndex: number) {
  const safeModuleId = moduleId.replace(/[^a-zA-Z0-9_-]/g, '_')
  return `m_${placementIndex}_${x}_${y}_${safeModuleId}`
}

function scopeSvgDefinitionIds(markup: string, scopeId: string) {
  if (!markup || !scopeId) return markup
  const idRegex = /\bid\s*=\s*(['"])([^'"]+)\1/g
  const idMap = new Map<string, string>()
  let match: RegExpExecArray | null
  while ((match = idRegex.exec(markup)) !== null) {
    const originalId = match[2]
    if (!originalId) continue
    if (idMap.has(originalId)) continue
    const safeOriginalId = originalId.replace(/[^a-zA-Z0-9_-]/g, '_')
    idMap.set(originalId, `${scopeId}__${safeOriginalId}`)
  }
  if (!idMap.size) return markup
  let out = markup
  for (const [originalId, scopedId] of idMap.entries()) {
    const escapedOriginalId = escapeRegExp(originalId)
    out = out.replace(
      new RegExp(`(\\bid\\s*=\\s*['"])${escapedOriginalId}(['"])`, 'g'),
      `$1${scopedId}$2`,
    )
    out = out.replace(
      new RegExp(`(url\\(\\s*#)${escapedOriginalId}(\\s*\\))`, 'g'),
      `$1${scopedId}$2`,
    )
    out = out.replace(new RegExp(`([#])${escapedOriginalId}(?=['"])`, 'g'), `$1${scopedId}`)
  }
  return out
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildSvg(
  grid: Grid,
  placements: Placement[],
  options: {
    size: number
    showBackground: boolean
    backgroundFill: string
    showStars: boolean
    debugBounds: boolean
    seedText: string
    randomSvgColors?: boolean
    focusedModuleId?: string
  },
) {
  const cellSize = CELL_SIZE
  const width = (grid[0]?.length ?? 0) * cellSize
  const height = grid.length * cellSize
  const iconSize = Math.max(1, Math.floor(options.size))
  const overlay = renderPlacedModules(
    placements,
    cellSize,
    options.debugBounds,
    options.seedText,
    options.randomSvgColors,
    options.focusedModuleId,
  )
  const sceneBounds =
    measureRenderedOverlayBounds(overlay, width, height) ??
    getSceneVisualBounds(placements, cellSize, options.debugBounds, options.focusedModuleId) ?? {
      minX: 0,
      minY: 0,
      maxX: width,
      maxY: height,
    }
  const sourceWidth = Math.max(1, sceneBounds.maxX - sceneBounds.minX)
  const sourceHeight = Math.max(1, sceneBounds.maxY - sceneBounds.minY)
  const fitScaleToBounds = Math.min(iconSize / sourceWidth, iconSize / sourceHeight)
  const minScaleForFill = (iconSize * MIN_ICON_FILL_RATIO) / Math.max(sourceWidth, sourceHeight)
  const fitScale = Math.max(fitScaleToBounds, minScaleForFill)
  const fitTranslateX = (iconSize - sourceWidth * fitScale) / 2 - sceneBounds.minX * fitScale
  const fitTranslateY = (iconSize - sourceHeight * fitScale) / 2 - sceneBounds.minY * fitScale
  const fittedOverlay = `<g transform="translate(${fitTranslateX} ${fitTranslateY}) scale(${fitScale})">${overlay}</g>`

  const background = options.showBackground
    ? `<rect x="0" y="0" width="${iconSize}" height="${iconSize}" fill="${escapeXml(options.backgroundFill)}"/>`
    : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${iconSize} ${iconSize}" width="${iconSize}" height="${iconSize}" role="img" aria-label="spaceship identicon">${background}${options.showStars ? renderStars(iconSize, iconSize) : ''}${fittedOverlay}</svg>`.trim()
}

const LEGACY_COLOR_TOKEN_MAP: Record<string, keyof MaterialPalette> = {
  '#dfe6f3': 'hull',
  '#d7deec': 'hull',
  '#d8dfed': 'hull',
  '#d8dfef': 'hull',
  '#d9e1ef': 'hull',
  '#d4dced': 'hull',
  '#cfd6e4': 'hullAccent',
  '#e9edf5': 'hullAccent',
  '#edf3fb': 'hullAccent',
  '#eef3fb': 'hullAccent',
  '#eefcff': 'windowGlow',
  '#e8fbff': 'windowGlow',
  '#c8f6ff': 'c4',
  '#83d8ff': 'window',
  '#8fdfff': 'window',
  '#89dcff': 'window',
  '#8cdcff': 'window',
  '#a8ecff': 'window',
  '#8da2ff': 'wing',
  '#58627c': 'c3',
  '#59627b': 'c3',
  '#5a647e': 'c3',
  '#6d7790': 'c3',
  '#6d788f': 'c3',
  '#8f9ab5': 'c4',
  '#ffb347': 'thrusterGlow',
  '#ffd37a': 'thrusterGlow',
  '#000000': 'c3',
  '#111111': 'c3',
  '#1a1a1a': 'c3',
  '#222222': 'c3',
}

function applyMaterialTokens(markup: string, palette: MaterialPalette) {
  let out = markup
  const paletteEntries = Object.entries(palette).sort((a, b) => b[0].length - a[0].length)
  for (const [key, color] of paletteEntries) {
    out = out.replaceAll(`material:${key}`, color)
    out = out.replaceAll(`var(--mat-${key})`, color)
    out = out.replaceAll(`{{mat:${key}}}`, color)
  }
  return out
}

export function applyMaterialPaletteToMarkup(
  markup: string,
  palette: ReturnType<typeof createMaterialPalette>,
) {
  const legacyTokenizedMarkup = applyLegacyMaterialTokenMap(markup)
  const withMaterialTokens = applyMaterialTokens(legacyTokenizedMarkup, palette)
  return applyMaterialClassStyles(withMaterialTokens, palette)
}

function applyLegacyMaterialTokenMap(markup: string) {
  if (!markup) return markup
  const replaceColor = (rawColor: string) => {
    const literal = rawColor.trim().toLowerCase()
    if (literal === 'black') return 'material:c3'
    if (literal === 'white') return 'material:c2'
    const normalized = normalizeHexColor(rawColor)
    if (!normalized) return rawColor
    const role = LEGACY_COLOR_TOKEN_MAP[normalized]
    if (role) return `material:${role}`
    return rawColor
  }
  let out = markup.replace(
    /\b(fill|stroke)\s*=\s*(['"])([^'"]+)\2/gi,
    (full, attrName: string, quote: string, rawValue: string) =>
      `${attrName}=${quote}${replaceColor(rawValue)}${quote}`,
  )
  out = out.replace(
    /\bstyle\s*=\s*(['"])([^'"]*)\1/gi,
    (full, quote: string, styleBody: string) => {
      const nextBody = styleBody
        .replace(/(?:^|;)\s*fill\s*:\s*([^;]+)/gi, (segment, value: string) =>
          segment.replace(value, replaceColor(value.trim())),
        )
        .replace(/(?:^|;)\s*stroke\s*:\s*([^;]+)/gi, (segment, value: string) =>
          segment.replace(value, replaceColor(value.trim())),
        )
      return `style=${quote}${nextBody}${quote}`
    },
  )
  return out
}

function normalizeHexColor(color: string) {
  const value = color.trim().toLowerCase()
  if (!value.startsWith('#')) return null
  if (/^#[0-9a-f]{3}$/i.test(value))
    return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`
  if (/^#[0-9a-f]{6}$/i.test(value)) return value
  return null
}

function applyMaterialClassStyles(markup: string, palette: MaterialPalette) {
  const style = [
    `.mat-c1{fill:${palette.c1}!important;}`,
    `.mat-c2{fill:${palette.c2}!important;}`,
    `.mat-c3{fill:${palette.c3}!important;}`,
    `.mat-c4{fill:${palette.c4}!important;}`,
    `.mat-hull{fill:${palette.hull}!important;}`,
    `.mat-hull-accent{fill:${palette.hullAccent}!important;}`,
    `.mat-hull-stroke{stroke:${palette.hullStroke}!important;}`,
    `.mat-window{fill:${palette.window}!important;}`,
    `.mat-window-glow{fill:${palette.windowGlow}!important;}`,
    `.mat-wing{fill:${palette.wing}!important;}`,
    `.mat-thruster{fill:${palette.thruster}!important;}`,
    `.mat-thruster-glow{fill:${palette.thrusterGlow}!important;}`,
  ].join('')
  return `<g><style>${style}</style>${markup}</g>`
}

type PaletteFamily = {
  name: string
  mainOffsets: [number, number, number, number]
  windowOffset: number
  accentOffset: number
  glowOffset: number
}

type PaletteTone = {
  name: string
  saturationBias: number
  lightnessBias: number
  accentLightnessBias: number
}

type HslColor = {
  h: number
  s: number
  l: number
}

const PALETTE_FAMILIES: PaletteFamily[] = [
  {
    name: 'analogous-warm-accent',
    mainOffsets: [0, 24, -18, 40],
    windowOffset: 154,
    accentOffset: 176,
    glowOffset: 188,
  },
  {
    name: 'split-complementary',
    mainOffsets: [0, 22, -24, 46],
    windowOffset: 146,
    accentOffset: 202,
    glowOffset: 214,
  },
  {
    name: 'triadic-biased',
    mainOffsets: [0, 18, -14, 28],
    windowOffset: 122,
    accentOffset: 242,
    glowOffset: 254,
  },
  {
    name: 'dual-cluster',
    mainOffsets: [0, 14, -20, 30],
    windowOffset: 168,
    accentOffset: 184,
    glowOffset: 198,
  },
]

const PALETTE_TONES: PaletteTone[] = [
  { name: 'bright-balanced', saturationBias: 0, lightnessBias: 0, accentLightnessBias: 0 },
  { name: 'cool-neon', saturationBias: 4, lightnessBias: -2, accentLightnessBias: 3 },
  { name: 'warm-pop', saturationBias: 2, lightnessBias: 1, accentLightnessBias: 2 },
  { name: 'deep-ink', saturationBias: 5, lightnessBias: -4, accentLightnessBias: 1 },
]

const MIN_DUAL_BG_CONTRAST = 1.95

function normalizeHue(hue: number) {
  const value = hue % 360
  return value < 0 ? value + 360 : value
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function makePaletteRng(seed: number) {
  let state = seed || 1
  return () => {
    state += 0x6d2b79f5
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function rangeJitter(rng: () => number, min: number, max: number) {
  return min + (max - min) * rng()
}

function randInt(rng: () => number, min: number, max: number) {
  return Math.floor(rangeJitter(rng, min, max + 1))
}

function makeHsl(h: number, s: number, l: number): HslColor {
  return {
    h: normalizeHue(h),
    s: clamp(s, 58, 100),
    l: clamp(l, 28, 78),
  }
}

function toHslCss(color: HslColor) {
  return hsl(color.h, color.s, color.l)
}

function hslLuminance(color: HslColor) {
  const [r, g, b] = hslToRgb(color.h, color.s / 100, color.l / 100)
  return relativeLuminance(r, g, b)
}

function contrastRatioFromLuminance(a: number, b: number) {
  const lighter = Math.max(a, b)
  const darker = Math.min(a, b)
  return (lighter + 0.05) / (darker + 0.05)
}

function minDualBackgroundContrast(color: HslColor) {
  const lum = hslLuminance(color)
  return Math.min(contrastRatioFromLuminance(lum, 0), contrastRatioFromLuminance(lum, 1))
}

function ensureDualBackgroundContrast(color: HslColor): HslColor {
  const next = { ...color }
  for (let i = 0; i < 7; i += 1) {
    if (minDualBackgroundContrast(next) >= MIN_DUAL_BG_CONTRAST) return next
    const lum = hslLuminance(next)
    if (lum > 0.44) next.l = clamp(next.l - 4, 28, 78)
    else if (lum < 0.07) next.l = clamp(next.l + 4, 28, 78)
    else next.l = clamp(next.l + (lum > 0.27 ? -2 : 2), 28, 78)
  }
  return next
}

function ensureRoleContrast(base: HslColor, other: HslColor, minRatio: number): HslColor {
  const next = { ...other }
  const baseLum = hslLuminance(base)
  for (let i = 0; i < 6; i += 1) {
    const ratio = contrastRatioFromLuminance(baseLum, hslLuminance(next))
    if (ratio >= minRatio) return next
    const lighten = baseLum < 0.25
    next.l = clamp(next.l + (lighten ? 4 : -4), 28, 78)
  }
  return next
}

function hslColorFromBase(baseHue: number, offset: number, rng: () => number, sBase: number, lBase: number) {
  return makeHsl(
    baseHue + offset + rangeJitter(rng, -14, 14),
    sBase + rangeJitter(rng, -6, 6),
    lBase + rangeJitter(rng, -7, 7),
  )
}

export function createMaterialPalette(seedText: string, randomSvgColors: boolean): MaterialPalette {
  if (!randomSvgColors) {
    return {
      c1: '#d8dfef',
      c2: '#83d8ff',
      c3: '#6d788f',
      c4: '#ffb347',
      hull: '#d8dfef',
      hullAccent: '#edf3fb',
      hullStroke: '#23346f',
      window: '#83d8ff',
      windowGlow: '#c8f1ff',
      wing: '#8da2ff',
      thruster: '#6d788f',
      thrusterGlow: '#ffb347',
    }
  }

  const seed = hashToken(seedText)
  const rng = makePaletteRng(seed ^ 0xa1f9c5d1)
  const family = PALETTE_FAMILIES[randInt(rng, 0, PALETTE_FAMILIES.length - 1)]!
  const tone = PALETTE_TONES[randInt(rng, 0, PALETTE_TONES.length - 1)]!
  const baseHue = randInt(rng, 0, 359)
  const [o1, o2, o3, o4] = family.mainOffsets
  const satBase = 80 + tone.saturationBias
  const lightBase = 50 + tone.lightnessBias

  let hull = hslColorFromBase(baseHue, o1, rng, satBase, lightBase)
  let hullAccent = hslColorFromBase(baseHue, o2, rng, satBase + 2, lightBase + 3)
  let hullStroke = hslColorFromBase(baseHue, o3, rng, satBase - 8, lightBase - 12)
  let wing = hslColorFromBase(baseHue, o4, rng, satBase + 1, lightBase - 3)
  let thruster = hslColorFromBase(baseHue, o4 + 10, rng, satBase - 2, lightBase - 5)
  let window = hslColorFromBase(baseHue, family.windowOffset, rng, satBase + 6, lightBase + 2)
  let windowGlow = hslColorFromBase(baseHue, family.glowOffset, rng, satBase + 9, lightBase + 8)
  let thrusterGlow = hslColorFromBase(
    baseHue,
    family.accentOffset,
    rng,
    satBase + 8,
    lightBase + 7 + tone.accentLightnessBias,
  )

  hull = ensureDualBackgroundContrast(hull)
  hullAccent = ensureDualBackgroundContrast(hullAccent)
  hullStroke = ensureDualBackgroundContrast(hullStroke)
  wing = ensureDualBackgroundContrast(wing)
  thruster = ensureDualBackgroundContrast(thruster)
  window = ensureDualBackgroundContrast(window)
  windowGlow = ensureDualBackgroundContrast(windowGlow)
  thrusterGlow = ensureDualBackgroundContrast(thrusterGlow)

  window = ensureRoleContrast(hull, window, 1.22)
  wing = ensureRoleContrast(hull, wing, 1.16)
  thrusterGlow = ensureRoleContrast(thruster, thrusterGlow, 1.2)
  windowGlow = ensureRoleContrast(window, windowGlow, 1.16)

  return {
    c1: toHslCss(hull),
    c2: toHslCss(window),
    c3: toHslCss(wing),
    c4: toHslCss(thrusterGlow),
    hull: toHslCss(hull),
    hullAccent: toHslCss(hullAccent),
    hullStroke: toHslCss(hullStroke),
    window: toHslCss(window),
    windowGlow: toHslCss(windowGlow),
    wing: toHslCss(wing),
    thruster: toHslCss(thruster),
    thrusterGlow: toHslCss(thrusterGlow),
  }
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hh = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hh % 2) - 1))
  const [r1, g1, b1] =
    hh < 1
      ? [c, x, 0]
      : hh < 2
        ? [x, c, 0]
        : hh < 3
          ? [0, c, x]
          : hh < 4
            ? [0, x, c]
            : hh < 5
              ? [x, 0, c]
              : [c, 0, x]
  const m = l - c / 2
  return [Math.round((r1 + m) * 255), Math.round((g1 + m) * 255), Math.round((b1 + m) * 255)]
}

function relativeLuminance(r: number, g: number, b: number) {
  const linearized = [r, g, b].map((channel) => {
    const value = channel / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  const sr = linearized[0] ?? 0
  const sg = linearized[1] ?? 0
  const sb = linearized[2] ?? 0
  return 0.2126 * sr + 0.7152 * sg + 0.0722 * sb
}

function hsl(h: number, s: number, l: number) {
  return `hsl(${Math.round(h)} ${Math.round(s)}% ${Math.round(l)}%)`
}

function hashToken(value: string) {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function renderPatternRects(pattern: PatternMatrix, cellSize: number) {
  let out = ''
  for (let y = 0; y < pattern.length; y += 1) {
    for (let x = 0; x < (pattern[0]?.length ?? 0); x += 1) {
      const value = pattern[y]![x]!
      if (value === IGNORE || value === SPACE) continue
      const px = x * cellSize
      const py = y * cellSize
      if (value === HULL)
        out += `<rect x="${px}" y="${py}" width="${cellSize}" height="${cellSize}" rx="3" fill="#e9edf5" stroke="#23346f" stroke-width="1.2"/>`
      else if (value === COCKPIT)
        out += `<rect x="${px}" y="${py}" width="${cellSize}" height="${cellSize}" rx="5" fill="#83d8ff" stroke="#23346f" stroke-width="1.2"/>`
      else if (value === WING)
        out += `<rect x="${px}" y="${py + cellSize * 0.18}" width="${cellSize}" height="${cellSize * 0.64}" rx="2" fill="#8da2ff" stroke="#23346f" stroke-width="1.2"/>`
      else if (value === THRUSTER) {
        out += `<rect x="${px + cellSize * 0.18}" y="${py + cellSize * 0.12}" width="${cellSize * 0.64}" height="${cellSize * 0.45}" rx="2" fill="#5a647e"/>`
        out += `<path d="M ${px + cellSize * 0.32} ${py + cellSize * 0.58} L ${px + cellSize * 0.5} ${py + cellSize * 0.92} L ${px + cellSize * 0.68} ${py + cellSize * 0.58}" fill="#ffb347"/>`
      }
    }
  }
  return out
}

function renderStars(width: number, height: number) {
  const stars: ReadonlyArray<readonly [number, number, number, number]> = [
    [0.12, 0.18, 1.7, 0.9],
    [0.32, 0.08, 1.2, 0.75],
    [0.76, 0.16, 1.9, 0.92],
    [0.84, 0.72, 1.4, 0.8],
    [0.18, 0.8, 1.6, 0.88],
    [0.62, 0.88, 1.15, 0.72],
    [0.52, 0.22, 1.35, 0.78],
    [0.9, 0.34, 1.05, 0.66],
  ]
  const defs = `
    <defs>
      <radialGradient id="shipStarGlow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#ffffff" stop-opacity="0.95"/>
        <stop offset="60%" stop-color="#d3eeff" stop-opacity="0.48"/>
        <stop offset="100%" stop-color="#d3eeff" stop-opacity="0"/>
      </radialGradient>
    </defs>
  `
  const twinkles = stars
    .map(([sx, sy, r, alpha]) => {
      const cx = sx * width
      const cy = sy * height
      const glowR = r * 3.2
      const sparkArm = r * 1.7
      return [
        `<circle cx="${cx}" cy="${cy}" r="${glowR}" fill="url(#shipStarGlow)" opacity="${Math.min(0.75, alpha)}"/>`,
        `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#ffffff" opacity="${alpha}"/>`,
        `<path d="M ${cx - sparkArm} ${cy} H ${cx + sparkArm} M ${cx} ${cy - sparkArm} V ${cy + sparkArm}" stroke="#d8f4ff" stroke-width="0.6" stroke-linecap="round" opacity="${Math.max(0.35, alpha - 0.25)}"/>`,
      ].join('')
    })
    .join('')
  return `${defs}${twinkles}`
}

function escapeXml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function runTests() {
  assert(
    JSON.stringify(
      rotatePattern([
        [1 as CellValue, 2 as CellValue],
        [3 as CellValue, 4 as CellValue],
      ]),
    ) ===
      JSON.stringify([
        [3, 1],
        [4, 2],
      ]),
    'rotatePattern failed',
  )
  const grid = createGrid(6, 6)
  const tile = normalizeModule({
    id: 'test',
    pattern: [
      [HULL, HULL],
      [IGNORE, HULL],
    ],
    svgVariants: {
      primary: {
        category: 'hull',
      },
    },
  })
  const fit = canPlaceTile(grid, { ...tile, rotation: 0, variantId: 'test@0' }, 2, 2)
  assert(Boolean(fit), 'canPlaceTile should accept empty placement')
  applyTile(grid, { ...tile, rotation: 0, variantId: 'test@0' }, 2, 2)
  assert(grid[2]![2] === HULL && grid[3]![3] === HULL, 'applyTile failed')
  const overlapRuleTile = normalizeModule({
    id: 'test-overlap-rule',
    pattern: [[HULL, HULL, HULL]],
    existingOverlapAllowIgnore: { hull: 2 },
    svgVariants: {
      primary: {
        category: 'hull',
      },
    },
  })
  const overlapRuleGrid = createGrid(6, 6)
  applyTile(
    overlapRuleGrid,
    { ...overlapRuleTile, rotation: 0, variantId: 'test-overlap-rule@0' },
    2,
    2,
  )
  assert(
    !canPlaceTile(
      overlapRuleGrid,
      { ...overlapRuleTile, rotation: 0, variantId: 'test-overlap-rule@1' },
      0,
      2,
    ),
    'canPlaceTile should reject placements that miss existingOverlapAllowIgnore by-category requirements',
  )
  assert(
    Boolean(
      canPlaceTile(
        overlapRuleGrid,
        { ...overlapRuleTile, rotation: 0, variantId: 'test-overlap-rule@2' },
        1,
        2,
      ),
    ),
    'canPlaceTile should accept placements that satisfy existingOverlapAllowIgnore by-category requirements',
  )
  assert(countComponents(grid) === 1, 'countComponents should detect single component')
  const ship = createSpaceshipScene('test-seed')
  assert(ship.placements.length > 0, 'createSpaceshipScene should place modules')
  assert(
    findBoundingBox(ship.grid, (value) => value !== UNSET && contributesToBounds(value)) !== null,
    'generated ship should have non-space bounds',
  )
}

runTests()
