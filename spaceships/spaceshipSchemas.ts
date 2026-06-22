import { z } from 'zod'

export const GRID_SIZE_MIN = 4
export const GRID_SIZE_MAX = 96
export const IDENTICON_SIZE_MIN = 32
export const IDENTICON_SIZE_MAX = 1024
export const STAGE_SELECTION_MODES = ['scored', 'weighted', 'random'] as const
export const REWIND_POLICIES = ['quality-first', 'strict-deterministic', 'explore'] as const

export const moduleCategorySchema = z
  .string()
  .min(1)
  .describe('Semantic role used by placement rules and generation requirements.')
export type ModuleCategory = z.infer<typeof moduleCategorySchema>

export const cellValueSchema = z.union([
  z.literal(-3),
  z.literal(-2),
  z.literal(-1),
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
])
export type CellValue = z.infer<typeof cellValueSchema>

export const patternMatrixSchema = z
  .array(z.array(cellValueSchema))
  .describe('Grid pattern describing module occupancy and per-cell ship semantics.')
export type PatternMatrix = z.infer<typeof patternMatrixSchema>

const nonNegativeIntSchema = z.number().int().min(0)
const positiveIntSchema = z.number().int().positive()
const rotationSchema = z.number().int().min(0).max(3)

export const categoryRequirementMapSchema = z
  .record(z.string().min(1), nonNegativeIntSchema)
  .describe('Counts keyed by arbitrary category names.')
export type CategoryRequirementMap = z.infer<typeof categoryRequirementMapSchema>

export const stageCategoryCountSchema = z.union([
  nonNegativeIntSchema,
  z
    .object({
      min: nonNegativeIntSchema.describe(
        'Inclusive lower bound for this category count in the stage.',
      ),
      max: nonNegativeIntSchema.describe(
        'Inclusive upper bound for this category count in the stage.',
      ),
    })
    .describe('Inclusive range bounds for this category count in the stage.')
    .refine((value) => value.min <= value.max, {
      message: '`min` must be less than or equal to `max`.',
      path: ['max'],
    }),
])
export type StageCategoryCount = z.infer<typeof stageCategoryCountSchema>

export const stageCategoryRequirementMapSchema = z
  .record(z.string().min(1), stageCategoryCountSchema)
  .describe('Per-category stage requirement as fixed count or inclusive range.')
export type StageCategoryRequirementMap = z.infer<typeof stageCategoryRequirementMapSchema>

export const stageSelectionModeSchema = z
  .enum(STAGE_SELECTION_MODES)
  .describe(
    [
      'How placement candidates are selected within a stage.',
      '`scored`: choose from the highest-scoring candidates first (best fit / strongest heuristic match).',
      '`weighted`: sample candidates by score-based probability (better candidates are more likely, but not guaranteed).',
      '`random`: choose uniformly from valid candidates (ignores scoring preferences).',
    ].join(' '),
  )
export type StageSelectionMode = z.infer<typeof stageSelectionModeSchema>

export const rewindPolicySchema = z
  .enum(REWIND_POLICIES)
  .describe('Cross-stage rewind behavior and retry strategy.')
export type RewindPolicy = z.infer<typeof rewindPolicySchema>

export const stageConfigSchema = z
  .object({
    selection: stageSelectionModeSchema,
    useVariantWeights: z
      .boolean()
      .optional()
      .describe(
        'Optional per-stage flag. When true, SVG variant weights influence candidate ordering/selection.',
      ),
    categories: stageCategoryRequirementMapSchema.describe('Per-category stage requirements.'),
  })
  .describe('Stage config with explicit selection strategy and category requirements.')
export type StageConfig = z.infer<typeof stageConfigSchema>

export const stagesConfigSchema = z
  .record(
    z
      .string()
      .regex(/^\d+$/, 'Stage keys must be numeric strings such as "1", "2", "3".'),
    stageConfigSchema,
  )
  .describe(
    'Stage map where each stage key defines required counts and optional selection strategy.',
  )
export type StagesConfig = z.infer<typeof stagesConfigSchema>

export const existingOverlapByCategorySchema = categoryRequirementMapSchema
export type ExistingOverlapByCategory = z.infer<typeof existingOverlapByCategorySchema>

export const gridSizeConfigSchema = z
  .object({
    width: z.number().int().min(GRID_SIZE_MIN).max(GRID_SIZE_MAX).describe('Grid width in cells.'),
    height: z
      .number()
      .int()
      .min(GRID_SIZE_MIN)
      .max(GRID_SIZE_MAX)
      .describe('Grid height in cells.'),
  })
  .describe('Spaceship generation grid size.')
export type GridSizeConfig = z.infer<typeof gridSizeConfigSchema>

export const svgTransformConfigSchema = z
  .object({
    offsetX: z.number().optional().describe('SVG X offset in grid-cell units.'),
    offsetY: z.number().optional().describe('SVG Y offset in grid-cell units.'),
    scaleX: z.number().positive().optional().describe('SVG X scale multiplier.'),
    scaleY: z.number().positive().optional().describe('SVG Y scale multiplier.'),
  })
  .describe('SVG transform overrides for a specific variant.')
export type SvgTransformConfig = z.infer<typeof svgTransformConfigSchema>

const existingOverlapBreakdownSchema = z
  .object({
    total: positiveIntSchema.optional().describe('Minimum total overlap count with existing cells.'),
    byCategory: existingOverlapByCategorySchema
      .optional()
      .describe('Minimum overlap counts by existing cell category.'),
  })
  .describe('Existing-overlap requirements with both total and by-category thresholds.')

export const existingOverlapConfigSchema = z.union([
  positiveIntSchema,
  existingOverlapByCategorySchema,
  existingOverlapBreakdownSchema,
])
export type ExistingOverlapConfig = z.infer<typeof existingOverlapConfigSchema>

export const spaceshipSvgVariantDefinitionSchema = z
  .object({
    category: moduleCategorySchema.describe(
      'Semantic category contributed by this SVG variant when selected for placement.',
    ),
    weight: z
      .number()
      .nonnegative()
      .optional()
      .describe(
        'Relative selection weight among SVG variants in the same module class/category. Default is 1.',
      ),
    svgMarkup: z
      .string()
      .optional()
      .describe('SVG fragment rendered for this variant.'),
    transform: svgTransformConfigSchema
      .optional()
      .describe('Per-variant transform overrides for this SVG variant.'),
    description: z
      .string()
      .optional()
      .describe('Human-readable notes for this SVG variant.'),
    zIndex: z
      .number()
      .optional()
      .describe('Optional render order for this SVG variant. Higher values render on top.'),
  })
  .describe('Single named SVG variant for a module.')
export type SpaceshipSvgVariantDefinition = z.infer<typeof spaceshipSvgVariantDefinitionSchema>

export const spaceshipModuleDefinitionSchema = z.object({
  id: z.string().min(1).describe('Unique module id.'),
  pattern: patternMatrixSchema,
  existingOverlapAllowIgnore: existingOverlapConfigSchema
    .optional()
    .describe(
      'Existing-overlap constraints where `ignore` cells are allowed to contribute on either side.',
    ),
  existingOverlapNoIgnore: existingOverlapConfigSchema
    .optional()
    .describe(
      'Existing-overlap constraints where overlaps involving `ignore` do not contribute.',
    ),
  maxCount: positiveIntSchema.optional().describe('Optional per-ship placement limit.'),
  rotations: z.array(rotationSchema).optional().describe('Allowed quarter-turn rotations.'),
  allowRotation: z.boolean().optional().describe('If false the solver will only use rotation 0.'),
  description: z.string().optional().describe('Human-readable module notes.'),
  svgVariants: z
    .record(z.string(), spaceshipSvgVariantDefinitionSchema)
    .describe('Named SVG variants keyed by variant name.'),
})
export type SpaceshipModuleDefinition = z.infer<typeof spaceshipModuleDefinitionSchema>

export const spaceshipAlgorithmConfigSchema = z
  .object({
    symmetry: z.boolean().describe('Whether generation mirrors placements horizontally.'),
    gridSize: gridSizeConfigSchema.describe('Grid dimensions for spaceship generation.'),
    stages: stagesConfigSchema.describe('Stage map of required module counts by category.'),
    identiconSize: z
      .number()
      .int()
      .min(IDENTICON_SIZE_MIN)
      .max(IDENTICON_SIZE_MAX)
      .describe('Rendered identicon size in CSS pixels.'),
    randomSvgColors: z
      .boolean()
      .describe('Whether SVG material colors are derived from the seed instead of fixed defaults.'),
    showBackground: z.boolean().describe('Whether the output SVG includes the backdrop.'),
    showStars: z.boolean().describe('Whether the output SVG includes the star field.'),
  })
  .describe('Generator-level settings for building a procedural spaceship.')
export type SpaceshipAlgorithmConfig = z.infer<typeof spaceshipAlgorithmConfigSchema>

export const spaceshipLibrarySchema = z
  .object({
    version: z.number().int().min(1).describe('Library file format version.'),
    algorithm: spaceshipAlgorithmConfigSchema.describe('Generator configuration stored with this library.'),
    moduleCatalog: z
      .array(spaceshipModuleDefinitionSchema)
      .describe('Module catalog available to the generator.'),
  })
  .describe('Portable procedural spaceship library file.')
export type SpaceshipLibraryFile = z.infer<typeof spaceshipLibrarySchema>

export type SpaceshipBoundingBox = {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export type ExpandedSpaceshipModule = Omit<
  SpaceshipModuleDefinition,
  | 'pattern'
  | 'existingOverlapAllowIgnore'
  | 'existingOverlapNoIgnore'
  | 'rotations'
  | 'maxCount'
  | 'allowRotation'
  | 'description'
  | 'svgVariants'
> & {
  pattern: PatternMatrix
  existingOverlapAllowIgnore: ExistingOverlapConfig
  existingOverlapNoIgnore: ExistingOverlapConfig
  rotations: number[]
  maxCount: number
  category: ModuleCategory
  svgVariantWeight: number
  svgMarkup: string
  svgVariantName: string
  svgTransform: SvgTransformConfig
  svgOffsetX: number
  svgOffsetY: number
  svgScaleX: number
  svgScaleY: number
  zIndex: number
  allowRotation: boolean
  description: string
  rotation: number
  variantId: string
}

export type Placement = {
  tile: ExpandedSpaceshipModule
  x: number
  y: number
  overlapCells: Array<{ x: number; y: number }>
}

export type SpaceshipScene = {
  version: string
  seedText: string
  symmetry: boolean
  gridSize: { width: number; height: number }
  grid: PatternMatrix
  placements: Placement[]
  moduleLibrarySnapshot: SpaceshipModuleDefinition[]
  usage: Record<string, number>
  stats: {
    hullCells: number
    cockpitCells: number
    thrusterCells: number
    wingCells: number
    moduleCount: number
    occupiedBounds: SpaceshipBoundingBox | null
  }
  summary: {
    symmetryLabel: string
    moduleCountLabel: string
  }
  debug?: {
    stageReports: Array<{
      stage: number
      selectionMode: StageSelectionMode
      requestedByCategory: CategoryRequirementMap
      finalDeficits: Array<{
        category: string
        requested: number
        placed: number
        deficit: number
      }>
      blockedCategories: string[]
      attempts: number
      maxAttempts: number
      backtracks?: number
      searchNodes?: number
      useVariantWeights?: boolean
      globalMaxRewinds?: number
      fellBackToGreedy?: boolean
      crossStageRewinds?: number
      stuckAtPlacementCount?: number
      stageRunCount?: number
      duplicateInputStates?: number
      lastRewindTargetStage?: number | null
      rewindStrategyUsed?: 'none' | 'nearest' | 'deeper'
      rewindDepth?: number
      stagnationDetected?: boolean
      bestCandidateKept?: boolean
      addedPlacementCount?: number
      addedModules?: Array<{
        moduleId: string
        variantId: string
        category: string
        x: number
        y: number
      }>
      candidateDiagnostics?: Array<{
        category: string
        requested: number
        placed: number
        tileCount: number
        candidateCount: number
        attemptedCandidates: number
        testedPositions?: number
        rejectionReasons?: Partial<
          Record<
            | 'outside-bounds'
            | 'blocking-cell'
            | 'cell-type-mismatch'
            | 'overlap-cell-disallowed'
            | 'existing-overlap-disallowed'
            | 'overlap-square'
            | 'no-new-cells'
            | 'no-support'
            | 'existing-overlap-allow-ignore-rule'
            | 'existing-overlap-no-ignore-rule',
            number
          >
        >
      }>
      stopReason:
        | 'requirements-satisfied'
        | 'no-tiles-for-deficit-categories'
        | 'no-candidates-for-deficit-categories'
        | 'attempt-limit-reached'
    }>
    unresolvedCategories: Array<{
      stage: number
      category: string
      requested: number
      placed: number
      deficit: number
    }>
  }
}

export type RenderSpaceshipSvgOptions = {
  size?: number
  showStars?: boolean
  showBackground?: boolean
  backgroundFill?: string
  debugBounds?: boolean
  moduleLibrary?: SpaceshipModuleDefinition[]
  symmetry?: boolean
  focusedModuleId?: string
  stages?: StagesConfig
  gridSize?: GridSizeConfig
  randomSvgColors?: boolean
  maxGlobalRewinds?: number
  maxIntraStageBacktracks?: number
  rewindPolicy?: RewindPolicy
  stagnationRepeatThreshold?: number
  preferDeeperRewindOnRepeat?: boolean
}
