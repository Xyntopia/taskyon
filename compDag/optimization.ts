// optimization.ts
import z from 'zod'
import type { JSONSchema7, JSONSchema7Definition } from 'json-schema'

export const runModeSchema = z.enum(['explore', 'optimize'])
export type RunMode = z.infer<typeof runModeSchema>

// -----------------------------
// VariableSpec
// -----------------------------

export const variableKindEnum = z
  .enum(['constant', 'sweep', 'grid', 'list'])
  .describe('How this parameter is treated during exploration or optimization.')

export const variableSpecSchema = z
  .union([
    z
      .object({
        description: z
          .string()
          .optional()
          .describe('Human-readable variable description shown in the optimization UI.'),
        kind: z.literal('constant').describe('Use a constant value for this parameter.'),
        value: z.any().optional().describe('Constant value. If omitted, the parameter is missing.'),
      })
      .describe('Constant value'),

    z
      .object({
        description: z
          .string()
          .optional()
          .describe('Human-readable variable description shown in the optimization UI.'),
        kind: z.literal('sweep').describe('Generate values using a numeric sweep.'),
        method: z
          .enum(['linear', 'log'])
          .default('linear')
          .describe('Sweep method. Only linear is implemented right now.'),
        start: z.number().describe('Start value (inclusive).'),
        end: z.number().describe('End value (inclusive).'),
        step: z.number().describe('Step size. Must not be 0.'),
      })
      .describe('Numeric sweep'),

    z
      .object({
        description: z
          .string()
          .optional()
          .describe('Human-readable variable description shown in the optimization UI.'),
        kind: z
          .literal('grid')
          .describe('Choose values from a fixed list and take the cartesian product.'),
        values: z.array(z.any()).describe('Candidate values.'),
      })
      .describe('Grid values'),

    z
      .object({
        description: z
          .string()
          .optional()
          .describe('Human-readable variable description shown in the optimization UI.'),
        kind: z
          .literal('list')
          .describe('Choose values from a fixed list and take the cartesian product.'),
        values: z.array(z.any()).describe('Candidate values.'),
      })
      .describe('List values'),
  ])
  .describe('Definition of how a parameter is varied.')

export type VariableSpec = z.infer<typeof variableSpecSchema>

// -----------------------------
// OptimizationConfig
// -----------------------------

export const objectiveTargetSchema = z.object({
  path: z.string().describe('Target path used to derive the objective value.'),
  op: z
    .enum(['identity', 'sum', 'mean', 'min', 'max', 'index'])
    .default('identity')
    .describe('Reduction/extraction op applied to the target path output.'),
  index: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('Index used when op=index. Ignored for other ops.'),
})
export type ObjectiveTarget = z.infer<typeof objectiveTargetSchema>

export const objectiveSchema = z.object({
  direction: z.enum(['min', 'max']).describe('Whether to minimize or maximize the objective.'),
  target: objectiveTargetSchema.describe('Target selection and optional reduction for objective.'),
})
export type Objective = z.infer<typeof objectiveSchema>

const sortSpecSchema = z.object({
  path: z.string().describe('Item field path used for ordering exploded input rows.'),
  direction: z
    .enum(['asc', 'desc'])
    .optional()
    .describe('Sort direction. Defaults to desc in DAG if omitted.'),
})

const providerSelectionSchema = z
  .union([
    z.object({
      kind: z.literal('name'),
      name: z.string().min(1).describe('Provider node name from oneOf(...) options.'),
    }),
    z.object({
      kind: z.literal('index'),
      index: z.number().int().nonnegative().describe('Provider index from oneOf(...) options.'),
    }),
  ])
  .describe('Explicit provider selection for oneOf() exposed inputs.')

const sequentialStrategySelectionSchema = z.object({
  id: z.literal('sequential'),
})

const nearestByLatLonStrategySelectionSchema = z.object({
  id: z.literal('nearestByLatLon'),
  args: z
    .object({
      latPath: z
        .string()
        .optional()
        .describe('Candidate field path for latitude. Defaults to centerLat.'),
      lonPath: z
        .string()
        .optional()
        .describe('Candidate field path for longitude. Defaults to centerLon.'),
      randomFraction: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe('Exploration fraction in [0, 1]. Defaults to 0.'),
    })
    .optional(),
})

const hotspotEpsilonGreedyStrategySelectionSchema = z.object({
  id: z.literal('hotspotEpsilonGreedy'),
  args: z
    .object({
      latPath: z
        .string()
        .optional()
        .describe('Candidate field path for latitude. Defaults to centerLat.'),
      lonPath: z
        .string()
        .optional()
        .describe('Candidate field path for longitude. Defaults to centerLon.'),
      randomFraction: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe('Exploration fraction in [0, 1]. Defaults to 0.1.'),
    })
    .optional(),
})

const studyStrategySelectionSchema = z
  .union([
    sequentialStrategySelectionSchema,
    nearestByLatLonStrategySelectionSchema,
    hotspotEpsilonGreedyStrategySelectionSchema,
  ])
  .describe('Candidate ordering strategy for this exploded input alias.')

export const optimizationInputSpecSchema = z.object({
  provider: providerSelectionSchema.optional(),
  sortBy: z
    .array(sortSpecSchema)
    .optional()
    .describe('Sort specifications applied to exploded input source arrays before evaluation.'),
  mode: z
    .enum(['cross', 'zip'])
    .optional()
    .describe('Combine exploded inputs via cartesian product (cross) or zip by run-order index.'),
  zipGroup: z
    .string()
    .optional()
    .describe('Zip group name. Inputs in the same group are zipped together.'),
  strategy: studyStrategySelectionSchema.optional(),
})

export type OptimizationInputSpec = z.infer<typeof optimizationInputSpecSchema>

export const optimizationConfigSchema = z
  .object({
    mode: z
      .enum(['explore', 'optimize'])
      .default('explore')
      .describe('Study mode.'),
    objective: objectiveSchema
      .optional()
      .describe('Single optimization objective used by study(mode=optimize).'),
    variables: z
      .record(z.string(), variableSpecSchema)
      .describe('Map from parameter path to variable specification (including constants).'),
    inputs: z
      .record(z.string(), optimizationInputSpecSchema)
      .default({})
      .describe('Per-input options for exploded exposed inputs.'),
    budget: z
      .object({
        maxRows: z.number().int().positive().optional(),
        maxEvals: z.number().int().positive().optional(),
        timeMs: z.number().int().positive().optional(),
      })
      .optional()
      .describe('Optional execution budget forwarded to study(...).'),
    rngSeed: z.number().int().optional().describe('Optional deterministic RNG seed.'),
  })
  .describe('Study-like optimization/exploration definition.')

export type OptimizationConfig = z.infer<typeof optimizationConfigSchema>

// -----------------------------
// Schema utilities
// -----------------------------

const unwrapSchema = (schema: z.ZodTypeAny): z.ZodTypeAny => {
  const def = (schema as unknown as { _def?: unknown })._def as
    | { innerType?: z.ZodTypeAny; schema?: z.ZodTypeAny; in?: z.ZodTypeAny; typeName?: string }
    | undefined

  if (schema instanceof z.ZodDefault && def?.innerType) return unwrapSchema(def.innerType)
  if (schema instanceof z.ZodOptional && def?.innerType) return unwrapSchema(def.innerType)
  if (schema instanceof z.ZodNullable && def?.innerType) return unwrapSchema(def.innerType)

  if (def?.typeName === 'ZodEffects' && def.schema) return unwrapSchema(def.schema)
  if (def?.typeName === 'ZodPipeline' && def.in) return unwrapSchema(def.in)

  return schema
}

const isArrayPath = (path: string) => path.includes('[]')
const isExplodedAliasPath = (path: string, aliases: string[]) =>
  aliases.some((alias) => path === alias || path.startsWith(`${alias}.`))

export const schemaAtPath = (schema: z.ZodTypeAny, path: string): z.ZodTypeAny | null => {
  if (!path) return schema
  const parts = path.split('.')
  let cur: z.ZodTypeAny = schema

  for (const rawSeg of parts) {
    if (rawSeg.endsWith('[]')) return null
    const u = unwrapSchema(cur)
    if (!(u instanceof z.ZodObject)) return null
    const shape = u.shape as Record<string, z.ZodTypeAny>
    const next = shape[rawSeg]
    if (!next) return null
    cur = next
  }

  return cur
}

export type SchemaPathKind =
  | 'number_scalar'
  | 'number_array'
  | 'object'
  | 'feature'
  | 'other'

const zodSchemaDescription = (schema: z.ZodTypeAny | null | undefined): string | undefined => {
  if (!schema) return undefined

  const metaDescriptionOf = (node: z.ZodTypeAny): string | undefined => {
    const metaFn = (node as unknown as { meta?: () => unknown }).meta
    if (typeof metaFn !== 'function') return undefined
    const meta = metaFn.call(node) as Record<string, unknown> | undefined
    return typeof meta?.description === 'string' ? meta.description.trim() : undefined
  }

  const seen = new Set<z.ZodTypeAny>()
  const walk = (node: z.ZodTypeAny | null | undefined): string | undefined => {
    if (!node || seen.has(node)) return undefined
    seen.add(node)

    const own = node.description?.trim() || metaDescriptionOf(node)
    if (own) return own

    const unwrapped = unwrapSchema(node)
    if (unwrapped !== node) {
      const unwrappedDesc = walk(unwrapped)
      if (unwrappedDesc) return unwrappedDesc
    }

    const def = (node as unknown as { _def?: unknown })._def as
      | { innerType?: z.ZodTypeAny; schema?: z.ZodTypeAny; in?: z.ZodTypeAny; out?: z.ZodTypeAny }
      | undefined

    return walk(def?.innerType) ?? walk(def?.schema) ?? walk(def?.in) ?? walk(def?.out)
  }

  return walk(schema)
}

const isFeatureSchemaNode = (schema: z.ZodTypeAny | null | undefined): boolean => {
  const desc = zodSchemaDescription(schema)?.toLowerCase() ?? ''
  return desc.includes('geojson feature') || desc.includes('feature geojson')
}

export const pathKindFromSchema = (schema: z.ZodTypeAny, path: string): SchemaPathKind => {
  const atPath = schemaAtPath(schema, path)
  if (!atPath) return 'other'
  const u = unwrapSchema(atPath)

  if (u instanceof z.ZodNumber) return 'number_scalar'
  if (u instanceof z.ZodArray) {
    const el = unwrapSchema(u.element as z.ZodTypeAny)
    return el instanceof z.ZodNumber ? 'number_array' : 'other'
  }
  if (u instanceof z.ZodObject) return isFeatureSchemaNode(atPath) ? 'feature' : 'object'
  if (isFeatureSchemaNode(atPath) || isFeatureSchemaNode(u)) return 'feature'
  return 'other'
}

export const listSchemaPaths = (schema: z.ZodTypeAny, prefix = ''): string[] => {
  const unwrapped = unwrapSchema(schema)

  if (unwrapped instanceof z.ZodObject) {
    const shape = unwrapped.shape
    const paths = Object.keys(shape).flatMap((key) => {
      const nextPrefix = prefix ? `${prefix}.${key}` : key
      return listSchemaPaths(shape[key] as z.ZodTypeAny, nextPrefix)
    })
    return paths.length > 0 ? paths : prefix ? [prefix] : []
  }

  if (unwrapped instanceof z.ZodArray) {
    // Arrays are not supported by setPathValue yet.
    const nextPrefix = prefix ? `${prefix}[]` : '[]'
    const items = listSchemaPaths(unwrapped.element as z.ZodTypeAny, nextPrefix)
    return items.length > 0 ? items : [nextPrefix]
  }

  return prefix ? [prefix] : ['value']
}

type LeafKind = 'number' | 'boolean' | 'string' | 'enum' | 'unknown'

const isEnumLike = (schema: z.ZodTypeAny): boolean => {
  const u = unwrapSchema(schema) as unknown as { _def?: { typeName?: string } }
  if (schema instanceof z.ZodEnum) return true
  // zod v4 does not export ZodNativeEnum as a class in some builds, so we detect it by typeName.
  return u?._def?.typeName === 'ZodNativeEnum'
}

const leafKindOf = (schema: z.ZodTypeAny): LeafKind => {
  const u = unwrapSchema(schema)
  if (u instanceof z.ZodNumber) return 'number'
  if (u instanceof z.ZodBoolean) return 'boolean'
  if (u instanceof z.ZodString) return 'string'
  if (u instanceof z.ZodEnum || isEnumLike(u)) return 'enum'
  return 'unknown'
}
export const listNumericSchemaPaths = (schema: z.ZodTypeAny): string[] => {
  const walk = (s: z.ZodTypeAny, prefix = ''): Array<{ path: string; kind: LeafKind }> => {
    const u = unwrapSchema(s)

    if (u instanceof z.ZodObject) {
      const shape = u.shape
      return Object.keys(shape).flatMap((key) => {
        const nextPrefix = prefix ? `${prefix}.${key}` : key
        return walk(shape[key] as z.ZodTypeAny, nextPrefix)
      })
    }

    if (u instanceof z.ZodArray) {
      // objectives into arrays are not supported for now
      return []
    }

    return prefix
      ? [{ path: prefix, kind: leafKindOf(u) }]
      : [{ path: 'value', kind: leafKindOf(u) }]
  }

  return walk(schema)
    .filter((x) => !isArrayPath(x.path) && x.kind === 'number')
    .map((x) => x.path)
}

export const createOptimizationConfig = (args: {
  paramsSchema: z.ZodTypeAny
  explodedInputAliases?: string[]
}): OptimizationConfig => {
  const explodedAliases = args.explodedInputAliases ?? []
  const variablePaths = listSchemaPaths(args.paramsSchema).filter(
    (p) => !isArrayPath(p) && !isExplodedAliasPath(p, explodedAliases),
  )
  const variables = Object.fromEntries(
    variablePaths.map((path) => [path, { kind: 'constant', value: undefined } as VariableSpec]),
  )
  const inputs = Object.fromEntries(
    (args.explodedInputAliases ?? []).map((alias) => [
      alias,
      { strategy: { id: 'sequential' } } as OptimizationInputSpec,
    ]),
  )

  return {
    mode: 'explore',
    variables,
    inputs,
    objective: undefined,
    budget: undefined,
    rngSeed: undefined,
  }
}

// -----------------------------
// Generic object path helpers
// -----------------------------

export const setPathValue = (target: Record<string, unknown>, path: string, value: unknown) => {
  const parts = path.split('.')
  let current: Record<string, unknown> = target

  for (let i = 0; i < parts.length; i++) {
    const key = parts[i]!

    if (key.endsWith('[]')) {
      throw new Error(`Array paths are not supported yet: ${path}`)
    }

    if (i === parts.length - 1) {
      current[key] = value
      return
    }

    const next = current[key]
    if (typeof next !== 'object' || next === null) {
      current[key] = {}
    }
    current = current[key] as Record<string, unknown>
  }
}

export const getPathValue = (source: unknown, path: string): unknown => {
  const parts = path.split('.')
  let current: unknown = source

  for (const key of parts) {
    if (key.endsWith('[]')) {
      throw new Error(`Array paths are not supported yet: ${path}`)
    }
    if (typeof current !== 'object' || current === null) return undefined
    current = (current as Record<string, unknown>)[key]
  }

  return current
}

// -----------------------------
// UI schema for ObjectView
// -----------------------------

const variableSpecSchemaForParam = (paramLeaf: z.ZodTypeAny, path: string): z.ZodTypeAny => {
  const leaf = unwrapSchema(paramLeaf)
  const isNumeric = leaf instanceof z.ZodNumber
  const paramDescription = (zodSchemaDescription(paramLeaf) ?? '').trim()
  const variableDescription = paramDescription
    ? `${paramDescription} (parameter path: ${path})`
    : `Optimization variable for parameter path: ${path}`

  const constant = z.object({
    kind: z.literal('constant').describe('Use a constant value.'),
    value: paramLeaf.optional().describe('Constant value. Leave empty to mark this parameter as missing.'),
  })

  const grid = z.object({
    kind: z.literal('grid').describe('Grid search values.'),
    values: z.array(paramLeaf).describe('Candidate values.'),
  })

  const list = z.object({
    kind: z.literal('list').describe('List of candidate values.'),
    values: z.array(paramLeaf).describe('Candidate values.'),
  })

  const sweep = z.object({
    kind: z.literal('sweep').describe('Numeric sweep.'),
    method: z
      .enum(['linear', 'log'])
      .default('linear')
      .describe('Sweep method. Only linear is implemented right now.'),
    start: z.number().describe('Start value (inclusive).'),
    end: z.number().describe('End value (inclusive).'),
    step: z.number().describe('Step size.'),
  })

  return z
    .union(isNumeric ? [constant, sweep, grid, list] : [constant, grid, list])
    .describe(variableDescription)
}

export const createOptimizationConfigUiJsonSchema = (args: {
  paramsSchema: z.ZodTypeAny
  outputSchema: z.ZodTypeAny
  explodedInputAliases?: string[]
  explodedInputAliasDescriptions?: Record<string, string>
}): JSONSchema7 => {
  const explodedAliases = args.explodedInputAliases ?? []
  const variablePaths = listSchemaPaths(args.paramsSchema).filter(
    (p) => !isArrayPath(p) && !isExplodedAliasPath(p, explodedAliases),
  )
  const paramsJsonSchema = z.toJSONSchema(args.paramsSchema, {
    unrepresentable: 'any',
  }) as JSONSchema7
  const paramDescriptionAtPath = (path: string): string | undefined => {
    const segments = path.split('.').filter((s) => s.length > 0)
    let cur: JSONSchema7 | undefined = paramsJsonSchema
    for (const seg of segments) {
      if (!cur || !('properties' in cur) || !cur.properties) return undefined
      const next: JSONSchema7Definition | undefined = (
        cur.properties as Record<string, JSONSchema7Definition>
      )[seg]
      if (!next || typeof next !== 'object') return undefined
      cur = next
    }
    return typeof cur?.description === 'string' ? cur.description.trim() : undefined
  }
  const objectivePaths = listNumericSchemaPaths(args.outputSchema).filter((p) => !isArrayPath(p))
  const objectivePathDescriptions = Object.fromEntries(
    objectivePaths.map((path) => [path, zodSchemaDescription(schemaAtPath(args.outputSchema, path))]),
  )
  const objectiveHelpLines = objectivePaths.map((path) => {
    const description = objectivePathDescriptions[path]
    return description ? `- ${path}: ${description}` : `- ${path}`
  })
  const objectivePathDescription =
    objectiveHelpLines.length > 0
      ? `Output path used as objective.\nAvailable numeric outputs:\n${objectiveHelpLines.join('\n')}`
      : 'Output path used as objective.'

  const variableShape: Record<string, z.ZodTypeAny> = {}
  const variableDescriptionsByPath: Record<string, string> = {}
  for (const path of variablePaths) {
    const leaf = schemaAtPath(args.paramsSchema, path)
    const leafDescription = (paramDescriptionAtPath(path) ?? zodSchemaDescription(leaf) ?? '').trim()
    variableDescriptionsByPath[path] = leafDescription
      ? `${leafDescription} (parameter path: ${path})`
      : `Optimization variable for parameter path: ${path}`
    variableShape[path] = variableSpecSchemaForParam(leaf ?? z.any(), path)
  }

  const inputShape: Record<string, z.ZodTypeAny> = {}
  const inputDescriptionsByAlias: Record<string, string> = {}
  for (const alias of args.explodedInputAliases ?? []) {
    const description =
      args.explodedInputAliasDescriptions?.[alias] ??
      `Explore/optimize options for input alias "${alias}".`
    inputDescriptionsByAlias[alias] = description
    inputShape[alias] = optimizationInputSpecSchema.describe(description)
  }

  const uiSchema = z.object({
    mode: optimizationConfigSchema.shape.mode,
    objective: z
      .object({
        direction: objectiveSchema.shape.direction,
        target: z.object({
          path: z.string().describe(objectivePathDescription),
          op: objectiveTargetSchema.shape.op,
          index: objectiveTargetSchema.shape.index,
        }),
      })
      .optional()
      .describe('Single optimization objective used by study(mode=optimize).'),
    variables: z
      .object(variableShape)
      .passthrough()
      .describe('Parameter variables. Use kind=constant for fixed call() values.'),
    inputs: z.object(inputShape).passthrough().default({}).describe('Per-input DAG options.'),
    budget: optimizationConfigSchema.shape.budget,
    rngSeed: optimizationConfigSchema.shape.rngSeed,
  })

  const json = z.toJSONSchema(uiSchema, { unrepresentable: 'any' }) as JSONSchema7
  const props = (json.properties ?? {}) as Record<string, JSONSchema7>
  const isJsonSchemaObject = (value: unknown): value is JSONSchema7 =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
  const strictifyObjectSchemas = (schemaDef: JSONSchema7Definition | undefined): void => {
    if (!isJsonSchemaObject(schemaDef)) return
    const schema = schemaDef

    const properties = schema.properties as Record<string, JSONSchema7Definition> | undefined
    if (properties) {
      const keys = Object.keys(properties)
      schema.required = keys
      schema.additionalProperties = false
      for (const child of Object.values(properties)) strictifyObjectSchemas(child)
    }

    if (Array.isArray(schema.anyOf)) {
      for (const child of schema.anyOf) strictifyObjectSchemas(child)
    }
    if (Array.isArray(schema.oneOf)) {
      for (const child of schema.oneOf) strictifyObjectSchemas(child)
    }
    if (Array.isArray(schema.allOf)) {
      for (const child of schema.allOf) strictifyObjectSchemas(child)
    }

    if (Array.isArray(schema.items)) {
      for (const child of schema.items) strictifyObjectSchemas(child)
    } else {
      strictifyObjectSchemas(schema.items)
    }
  }
  if (props.mode) props.mode.title = 'Study Mode'
  if (props.objective) props.objective.title = 'Study Objective'
  if (isJsonSchemaObject(props.objective)) strictifyObjectSchemas(props.objective)
  const objectiveSchemas: JSONSchema7[] = []
  if (isJsonSchemaObject(props.objective)) {
    objectiveSchemas.push(props.objective)
    if (Array.isArray(props.objective.anyOf)) {
      for (const s of props.objective.anyOf) {
        if (isJsonSchemaObject(s)) objectiveSchemas.push(s)
      }
    }
    if (Array.isArray(props.objective.oneOf)) {
      for (const s of props.objective.oneOf) {
        if (isJsonSchemaObject(s)) objectiveSchemas.push(s)
      }
    }
  }

  for (const schema of objectiveSchemas) {
    const objectiveProperties = (schema.properties ?? {}) as Record<string, JSONSchema7Definition>
    const targetSchema = objectiveProperties.target
    if (!isJsonSchemaObject(targetSchema)) continue
    const targetProperties = (targetSchema.properties ?? {}) as Record<string, JSONSchema7Definition>
    const pathSchema = targetProperties.path
    if (!isJsonSchemaObject(pathSchema)) continue
    pathSchema.title = 'Output Variable'
    if (objectivePaths.length > 0) {
      pathSchema.enum = [...objectivePaths]
    }
  }

  if (isJsonSchemaObject(props.variables)) {
    // Azure structured-output requires nested object schemas to include
    // additionalProperties:false and required arrays that list all property keys.
    props.variables.additionalProperties = false
    strictifyObjectSchemas(props.variables)
    const variableProps = props.variables.properties as Record<string, JSONSchema7Definition> | undefined
    if (variableProps) {
      for (const [path, description] of Object.entries(variableDescriptionsByPath)) {
        const schema = variableProps[path]
        if (isJsonSchemaObject(schema)) schema.description = description
      }
    }
  }

  if (isJsonSchemaObject(props.inputs)) {
    // Match provider strictness for nested object schema validation.
    props.inputs.additionalProperties = false
    strictifyObjectSchemas(props.inputs)
    const inputProps = props.inputs.properties as Record<string, JSONSchema7Definition> | undefined
    if (inputProps) {
      for (const [alias, description] of Object.entries(inputDescriptionsByAlias)) {
        const schema = inputProps[alias]
        if (isJsonSchemaObject(schema)) schema.description = description
      }
    }
  }

  if (isJsonSchemaObject(props.budget)) {
    strictifyObjectSchemas(props.budget)
  }

  if (props.variables) props.variables.title = 'Variable Strategies (Including Constants)'
  if (props.inputs) props.inputs.title = 'Internal Variables (Exploded Inputs)'
  if (props.budget) props.budget.title = 'Study Budget'
  if (props.rngSeed) props.rngSeed.title = 'Random Seed'

  // Azure structured-output requires required to include all root property keys.
  if (json.properties) {
    json.required = Object.keys(json.properties as Record<string, JSONSchema7Definition>)
    json.additionalProperties = false
  }

  return json
}

// -----------------------------
// Validation helpers
// -----------------------------

export type OptimizationValidationIssue = {
  path: string
  message: string
  code?: string
}

export type OptimizationValidationReport = {
  ok: boolean
  summary: string
  issues: OptimizationValidationIssue[]
  details?: unknown
}

export const validateOptimizationBeforeRun = (args: {
  config: OptimizationConfig
  nodeParamsSchema: z.ZodTypeAny
}): OptimizationValidationReport => {
  const issues: OptimizationValidationIssue[] = []
  const variables = (args.config as Partial<OptimizationConfig>).variables

  // 1) quick sanity on objective
  if (args.config.mode === 'optimize' && !args.config.objective) {
    issues.push({
      path: 'objective',
      message: 'Optimize mode requires an objective.',
      code: 'missing_objective',
    })
  }

  // 2) build a candidate params object from variable constants and seeded dimensions
  const baseParamsRaw: Record<string, unknown> = {}

  for (const [path, specRaw] of Object.entries(variables ?? {})) {
    if (!specRaw || typeof specRaw !== 'object') {
      issues.push({
        path: `variables.${path}`,
        message: 'Invalid variable specification.',
        code: 'invalid_variable_spec',
      })
      continue
    }

    const spec = specRaw as Partial<VariableSpec> & Record<string, unknown>

    if (isArrayPath(path)) {
      issues.push({
        path: `variables.${path}`,
        message: `Array parameter paths are not supported yet: ${path}`,
        code: 'unsupported_array_path',
      })
      continue
    }

    if (spec.kind === 'constant') {
      // Undefined means this required parameter is still missing.
      if (spec.value !== undefined) setPathValue(baseParamsRaw, path, spec.value)
      continue
    }

    if (spec.kind === 'sweep') {
      const method = spec.method
      if (method !== 'linear') {
        issues.push({
          path: `variables.${path}.method`,
          message: `Sweep method ${String(method)} is not implemented yet. Use linear.`,
          code: 'unimplemented',
        })
        continue
      }

      const step = spec.step
      if (typeof step !== 'number' || !Number.isFinite(step)) {
        issues.push({
          path: `variables.${path}.step`,
          message: 'Sweep step must be a finite number.',
          code: 'invalid_step',
        })
        continue
      }

      if (step === 0) {
        issues.push({
          path: `variables.${path}.step`,
          message: 'Sweep step cannot be 0.',
          code: 'invalid_step',
        })
        continue
      }

      // seed validation with the first value
      setPathValue(baseParamsRaw, path, spec.start)
      continue
    }

    if (spec.kind === 'grid' || spec.kind === 'list') {
      const values = spec.values
      if (!Array.isArray(values)) {
        issues.push({
          path: `variables.${path}.values`,
          message: 'Grid or list variable values must be an array.',
          code: 'invalid_values',
        })
        continue
      }
      if (values.length === 0) {
        issues.push({
          path: `variables.${path}.values`,
          message: 'Grid or list variable has no values.',
          code: 'empty_values',
        })
        continue
      }

      setPathValue(baseParamsRaw, path, values[0])
      continue
    }

    issues.push({
      path: `variables.${path}`,
      message: `Unsupported variable kind: ${String(spec.kind)}`,
      code: 'unsupported_kind',
    })
  }

  const parsed = args.nodeParamsSchema.safeParse(baseParamsRaw)
  if (!parsed.success) {
    for (const i of parsed.error.issues) {
      const p = i.path.join('.')
      const isMissingRequired =
        i.code === 'invalid_type' &&
        (i as unknown as { received?: unknown }).received === 'undefined'

      issues.push({
        path: p ? `variables.${p}.value` : 'variables',
        message: isMissingRequired ? `Missing required parameter: ${p}` : i.message,
        code: i.code,
      })
    }
  }

  if (issues.length > 0) {
    return {
      ok: false,
      summary: `Cannot run: ${issues.length} validation issue${issues.length === 1 ? '' : 's'}.`,
      issues,
      details: { baseParamsRaw },
    }
  }

  return { ok: true, summary: 'OK', issues: [] }
}

// -----------------------------
// Optimization results schema
// -----------------------------

export const objectiveValueSchema = z.number().nullable()
export type ObjectiveValue = z.infer<typeof objectiveValueSchema>

export const objectiveMapSchema = z.record(z.string(), objectiveValueSchema)
export type ObjectiveMap = z.infer<typeof objectiveMapSchema>

export const optimizationRunRecordSchema = z.object({
  params: z.any().describe('Validated params used for this run.'),
  outputs: z
    .any()
    .describe('Outputs of the run. Typically the output of the selected output node.'),
  objectives: objectiveMapSchema.describe('Objective values computed from the node output.'),
})
export type OptimizationRunRecord = z.infer<typeof optimizationRunRecordSchema>

export const optimizationResultsSchema = z.object({
  nodeKey: z.string().describe('Key of the selected output node in the UI.'),
  nodeName: z.string().describe('Node name.'),
  mode: runModeSchema.describe('Run mode.'),
  runs: z.array(optimizationRunRecordSchema).describe('All explored or optimized runs.'),
  bestIndex: z.number().nullable().describe('Index into runs for the best run, if applicable.'),
})
export type OptimizationResults = z.infer<typeof optimizationResultsSchema>

const ensureObjectLikeOutputSchema = (schema: z.ZodTypeAny): z.ZodTypeAny => {
  const u = unwrapSchema(schema)
  if (u instanceof z.ZodObject) {
    // Allow extra keys in UI because real outputs may contain extra fields.
    return u.passthrough()
  }
  // Non-object node outputs are wrapped by the runner into { value: ... }
  return z
    .object({
      value: schema,
    })
    .passthrough()
}

export const createOptimizationResultsUiJsonSchema = (args: {
  nodeParamsSchema: z.ZodTypeAny
  nodeOutputSchema: z.ZodTypeAny
}): JSONSchema7 => {
  const outputsSchema = ensureObjectLikeOutputSchema(args.nodeOutputSchema).describe(
    'Outputs of the run. If the run was configured to only record specific output paths, some fields may be missing.',
  )

  const uiSchema = z.object({
    nodeKey: optimizationResultsSchema.shape.nodeKey,
    nodeName: optimizationResultsSchema.shape.nodeName,
    mode: optimizationResultsSchema.shape.mode,
    bestIndex: optimizationResultsSchema.shape.bestIndex,
    runs: z.array(
      z.object({
        params: args.nodeParamsSchema.describe('Params used for this run.'),
        outputs: outputsSchema,
        objectives: objectiveMapSchema,
      }),
    ),
  })

  return z.toJSONSchema(uiSchema, { unrepresentable: 'any' }) as JSONSchema7
}
