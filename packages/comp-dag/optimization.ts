// optimization.ts
import z from 'zod'
import type { JSONSchema7, JSONSchema7Definition } from 'json-schema'
import {
  safeParseSchema,
  schemaArrayElement,
  schemaAtPath as jsonSchemaAtPath,
  schemaDescription,
  type DagJsonSchema,
} from './dagSchema.ts'

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
        value: z
          .unknown()
          .optional()
          .describe('Constant value. If omitted, the parameter is missing.'),
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
        values: z.array(z.unknown()).describe('Candidate values.'),
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
        values: z.array(z.unknown()).describe('Candidate values.'),
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

export const optimizationCaptureSpecSchema = z.object({
  path: z
    .string()
    .describe(
      'Explicit value to capture per row. Supported roots: params.*, outputs.*, or an input alias such as parcel.*.',
    ),
  as: z
    .string()
    .optional()
    .describe('Optional output key inside row.captured. Defaults to the capture path.'),
})
export type OptimizationCaptureSpec = z.infer<typeof optimizationCaptureSpecSchema>

export const optimizationConfigSchema = z
  .object({
    mode: z.enum(['explore', 'optimize']).default('explore').describe('Study mode.'),
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
    capture: z
      .array(optimizationCaptureSpecSchema)
      .optional()
      .describe(
        'Optional internal values to persist per row. Values are written to row.captured using their path or `as` alias.',
      ),
    rngSeed: z.number().int().optional().describe('Optional deterministic RNG seed.'),
  })
  .describe('Study-like optimization/exploration definition.')

export type OptimizationConfig = z.infer<typeof optimizationConfigSchema>

// -----------------------------
// Schema utilities
// -----------------------------

const isArrayPath = (path: string) => path.includes('[]')
const isExplodedAliasPath = (path: string, aliases: string[]) =>
  aliases.some((alias) => path === alias || path.startsWith(`${alias}.`))

export const schemaAtPath = jsonSchemaAtPath

export type SchemaPathKind = 'number_scalar' | 'number_array' | 'object' | 'feature' | 'other'

type DagJsonSchemaObject = Extract<DagJsonSchema, Record<string, unknown>>

const isObjectSchema = (schema: DagJsonSchema | null | undefined): schema is DagJsonSchemaObject =>
  typeof schema === 'object' && schema !== null && !Array.isArray(schema)

const schemaTypes = (schema: DagJsonSchema): string[] => {
  if (!isObjectSchema(schema)) return []
  const type = schema.type
  return Array.isArray(type) ? type : typeof type === 'string' ? [type] : []
}

const isFeatureSchemaNode = (schema: DagJsonSchema | null | undefined): boolean => {
  const desc = schemaDescription(schema)?.toLowerCase() ?? ''
  return desc.includes('geojson feature') || desc.includes('feature geojson')
}

export const pathKindFromSchema = (schema: DagJsonSchema, path: string): SchemaPathKind => {
  const atPath = schemaAtPath(schema, path)
  if (!atPath) return 'other'
  const types = schemaTypes(atPath)
  if (types.includes('number') || types.includes('integer')) return 'number_scalar'
  if (types.includes('array') || (isObjectSchema(atPath) && 'items' in atPath)) {
    const el = schemaArrayElement(atPath)
    return el && schemaTypes(el).some((t) => t === 'number' || t === 'integer')
      ? 'number_array'
      : 'other'
  }
  if (types.includes('object') || (isObjectSchema(atPath) && 'properties' in atPath)) {
    return isFeatureSchemaNode(atPath) ? 'feature' : 'object'
  }
  if (isFeatureSchemaNode(atPath)) return 'feature'
  return 'other'
}

export const listSchemaPaths = (schema: DagJsonSchema, prefix = ''): string[] => {
  if (isObjectSchema(schema) && 'properties' in schema && !Array.isArray(schema.properties)) {
    const properties = schema.properties as Record<string, DagJsonSchema> | undefined
    if (!properties) return prefix ? [prefix] : []
    const paths = Object.keys(properties).flatMap((key) => {
      const nextPrefix = prefix ? `${prefix}.${key}` : key
      return listSchemaPaths(properties[key] as DagJsonSchema, nextPrefix)
    })
    return paths.length > 0 ? paths : prefix ? [prefix] : []
  }

  if (isObjectSchema(schema) && (schema.type === 'array' || 'items' in schema)) {
    // Arrays are not supported by setPathValue yet.
    const nextPrefix = prefix ? `${prefix}[]` : '[]'
    const itemSchema = schemaArrayElement(schema)
    const items = itemSchema ? listSchemaPaths(itemSchema, nextPrefix) : []
    return items.length > 0 ? items : [nextPrefix]
  }

  return prefix ? [prefix] : ['value']
}

type LeafKind = 'number' | 'boolean' | 'string' | 'enum' | 'unknown'

const leafKindOf = (schema: DagJsonSchema): LeafKind => {
  if (isObjectSchema(schema) && 'enum' in schema && Array.isArray(schema.enum)) return 'enum'
  const types = schemaTypes(schema)
  if (types.includes('number') || types.includes('integer')) return 'number'
  if (types.includes('boolean')) return 'boolean'
  if (types.includes('string')) return 'string'
  return 'unknown'
}
export const listNumericSchemaPaths = (schema: DagJsonSchema): string[] => {
  const walk = (s: DagJsonSchema, prefix = ''): Array<{ path: string; kind: LeafKind }> => {
    if (isObjectSchema(s) && 'properties' in s && !Array.isArray(s.properties)) {
      const properties = s.properties as Record<string, DagJsonSchema> | undefined
      if (!properties) return []
      return Object.keys(properties).flatMap((key) => {
        const nextPrefix = prefix ? `${prefix}.${key}` : key
        return walk(properties[key] as DagJsonSchema, nextPrefix)
      })
    }

    if (isObjectSchema(s) && (s.type === 'array' || 'items' in s)) {
      // objectives into arrays are not supported for now
      return []
    }

    return prefix
      ? [{ path: prefix, kind: leafKindOf(s) }]
      : [{ path: 'value', kind: leafKindOf(s) }]
  }

  return walk(schema)
    .filter((x) => !isArrayPath(x.path) && x.kind === 'number')
    .map((x) => x.path)
}

export const createOptimizationConfig = (args: {
  paramsSchema: DagJsonSchema
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
    capture: undefined,
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

const zodForJsonLeaf = (schema: DagJsonSchema | null): z.ZodTypeAny => {
  if (!schema || !isObjectSchema(schema)) return z.unknown()
  const enumValues = 'enum' in schema && Array.isArray(schema.enum) ? schema.enum : []
  if (enumValues.length > 0) {
    const literals = enumValues.map((x: unknown) => z.literal(x as never))
    return literals.length === 1
      ? literals[0]!
      : z.union(literals as unknown as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]])
  }
  const types = schemaTypes(schema)
  if (types.includes('number') || types.includes('integer')) return z.number()
  if (types.includes('boolean')) return z.boolean()
  if (types.includes('string')) return z.string()
  return z.unknown()
}

const variableSpecSchemaForParam = (
  paramLeaf: DagJsonSchema | null,
  path: string,
): z.ZodTypeAny => {
  const leaf = zodForJsonLeaf(paramLeaf)
  const isNumeric = paramLeaf ? leafKindOf(paramLeaf) === 'number' : false
  const paramDescription = (schemaDescription(paramLeaf) ?? '').trim()
  const variableDescription = paramDescription
    ? `${paramDescription} (parameter path: ${path})`
    : `Optimization variable for parameter path: ${path}`

  const constant = z.object({
    kind: z.literal('constant').describe('Use a constant value.'),
    value: leaf
      .optional()
      .describe('Constant value. Leave empty to mark this parameter as missing.'),
  })

  const grid = z.object({
    kind: z.literal('grid').describe('Grid search values.'),
    values: z.array(leaf).describe('Candidate values.'),
  })

  const list = z.object({
    kind: z.literal('list').describe('List of candidate values.'),
    values: z.array(leaf).describe('Candidate values.'),
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
  paramsSchema: DagJsonSchema
  outputSchema: DagJsonSchema
  explodedInputAliases?: string[]
  explodedInputAliasDescriptions?: Record<string, string>
}): JSONSchema7 => {
  const explodedAliases = args.explodedInputAliases ?? []
  const variablePaths = listSchemaPaths(args.paramsSchema).filter(
    (p) => !isArrayPath(p) && !isExplodedAliasPath(p, explodedAliases),
  )
  const paramsJsonSchema = args.paramsSchema as JSONSchema7
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
    objectivePaths.map((path) => [path, schemaDescription(schemaAtPath(args.outputSchema, path))]),
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
    const leafDescription = (paramDescriptionAtPath(path) ?? schemaDescription(leaf) ?? '').trim()
    variableDescriptionsByPath[path] = leafDescription
      ? `${leafDescription} (parameter path: ${path})`
      : `Optimization variable for parameter path: ${path}`
    variableShape[path] = variableSpecSchemaForParam(leaf, path)
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
    capture: optimizationConfigSchema.shape.capture,
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
    const targetProperties = (targetSchema.properties ?? {}) as Record<
      string,
      JSONSchema7Definition
    >
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
    const variableProps = props.variables.properties as
      | Record<string, JSONSchema7Definition>
      | undefined
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
  nodeParamsSchema: DagJsonSchema
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

  const parsed = safeParseSchema(args.nodeParamsSchema, baseParamsRaw)
  if (!parsed.success) {
    for (const i of parsed.error.issues) {
      const p = i.path.join('.')

      issues.push({
        path: p ? `variables.${p}.value` : 'variables',
        message: i.code === 'required' ? `Missing required parameter: ${p}` : i.message,
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
  params: z.unknown().describe('Validated params used for this run.'),
  outputs: z
    .unknown()
    .describe('Outputs of the run. Typically the output of the selected output node.'),
  objectives: objectiveMapSchema.describe('Objective values computed from the node output.'),
  captured: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Explicitly captured internal values requested by the execution config.'),
  rowKey: z
    .record(z.string(), z.union([z.string(), z.number()]))
    .optional()
    .describe('Stable source-row identity for an explored input combination.'),
  status: z.string().optional().describe('Transient presentation status for this result row.'),
})
export type OptimizationRunRecord = z.infer<typeof optimizationRunRecordSchema>

export const optimizationResultsSchema = z.object({
  nodeKey: z.string().describe('Key of the selected output node in the UI.'),
  nodeName: z.string().describe('Node name.'),
  mode: runModeSchema.describe('Run mode.'),
  runs: z.array(optimizationRunRecordSchema).describe('All explored or optimized runs.'),
  bestIndex: z.number().nullable().describe('Index into runs for the best run, if applicable.'),
  meta: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Transient execution metadata projected from the canonical invocation run.'),
})
export type OptimizationResults = z.infer<typeof optimizationResultsSchema>

const ensureObjectLikeOutputSchema = (schema: DagJsonSchema): JSONSchema7 => {
  if (isObjectSchema(schema) && (schema.type === 'object' || 'properties' in schema)) {
    return {
      ...(schema as JSONSchema7),
      additionalProperties: true,
    }
  }
  return {
    type: 'object',
    properties: {
      value: schema as JSONSchema7,
    },
    additionalProperties: true,
  }
}

export const createOptimizationResultsUiJsonSchema = (args: {
  nodeParamsSchema: DagJsonSchema
  nodeOutputSchema: DagJsonSchema
}): JSONSchema7 => {
  const outputsSchema = ensureObjectLikeOutputSchema(args.nodeOutputSchema)
  outputsSchema.description =
    'Outputs of the run. If the run was configured to only record specific output paths, some fields may be missing.'

  const uiSchema = z.object({
    nodeKey: optimizationResultsSchema.shape.nodeKey,
    nodeName: optimizationResultsSchema.shape.nodeName,
    mode: optimizationResultsSchema.shape.mode,
    bestIndex: optimizationResultsSchema.shape.bestIndex,
    runs: z.array(
      z.object({
        params: z.unknown().describe('Params used for this run.'),
        outputs: z.unknown(),
        objectives: objectiveMapSchema,
        captured: z
          .record(z.string(), z.unknown())
          .optional()
          .describe('Explicitly captured internal values requested by the execution config.'),
      }),
    ),
  })

  const json = z.toJSONSchema(uiSchema, { unrepresentable: 'any' }) as JSONSchema7
  const runSchema = ((
    (json.properties?.runs as JSONSchema7 | undefined)?.items as JSONSchema7 | undefined
  )?.properties ?? {}) as Record<string, JSONSchema7Definition>
  runSchema.params = {
    ...(args.nodeParamsSchema as JSONSchema7),
    description: 'Params used for this run.',
  }
  runSchema.outputs = outputsSchema
  return json
}
