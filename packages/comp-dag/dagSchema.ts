import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv'
import addFormats from 'ajv-formats'
import type { FromSchema, JSONSchema } from 'json-schema-to-ts'

export type DagJsonSchema = JSONSchema
export type DagSchemaType<S extends DagJsonSchema> = FromSchema<S>
type DagJsonSchemaObject = Extract<DagJsonSchema, Record<string, unknown>>

export type DagSchemaIssue = {
  path: (string | number)[]
  message: string
  code: string
}

export type DagSchemaParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: { issues: DagSchemaIssue[] } }

const ajv = new Ajv({
  allErrors: true,
  removeAdditional: true,
  useDefaults: true,
  strict: false,
})
addFormats(ajv)

const validatorCache = new WeakMap<object, ValidateFunction>()

export const objectSchema = <
  const Properties extends Record<string, DagJsonSchema>,
  const Required extends readonly (keyof Properties & string)[] = readonly [],
>(args?: {
  properties?: Properties
  required?: Required
  additionalProperties?: DagJsonSchema
  description?: string
  title?: string
}) =>
  ({
    type: 'object',
    properties: args?.properties ?? {},
    required: args?.required ?? [],
    additionalProperties: args?.additionalProperties ?? false,
    ...(args?.description ? { description: args.description } : {}),
    ...(args?.title ? { title: args.title } : {}),
  }) as const

export const emptyObjectSchema = objectSchema()

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isSchemaObject = (value: DagJsonSchema | null | undefined): value is DagJsonSchemaObject =>
  isObjectRecord(value)

export const cloneJson = <T>(value: T): T => {
  const sc = (globalThis as unknown as { structuredClone?: (v: unknown) => unknown })
    .structuredClone
  if (typeof sc === 'function') return sc(value) as T
  return JSON.parse(JSON.stringify(value)) as T
}

const compileValidator = (schema: DagJsonSchema): ValidateFunction => {
  if (typeof schema === 'object' && schema !== null) {
    const cached = validatorCache.get(schema)
    if (cached) return cached
    const compiled = ajv.compile(schema as object)
    validatorCache.set(schema, compiled)
    return compiled
  }
  return ajv.compile(schema as unknown as object)
}

const pathFromAjv = (instancePath: string): (string | number)[] =>
  instancePath
    .split('/')
    .filter(Boolean)
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
    .map((part) => (/^\d+$/.test(part) ? Number(part) : part))

const issueFromAjv = (error: ErrorObject): DagSchemaIssue => ({
  path: pathFromAjv(error.instancePath),
  message: error.message ?? 'Invalid value',
  code: error.keyword,
})

export const safeParseSchema = <T = unknown>(
  schema: DagJsonSchema,
  value: unknown,
): DagSchemaParseResult<T> => {
  const data = cloneJson(value)
  const validator = compileValidator(schema)
  if (validator(data)) return { success: true, data: data as T }
  return {
    success: false,
    error: { issues: (validator.errors ?? []).map(issueFromAjv) },
  }
}

export const parseSchema = <T = unknown>(schema: DagJsonSchema, value: unknown): T => {
  const parsed = safeParseSchema<T>(schema, value)
  if (parsed.success) return parsed.data
  const details = parsed.error.issues
    .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
    .join('; ')
  throw new Error(`Schema validation failed: ${details}`)
}

export const schemaDescription = (schema: DagJsonSchema | null | undefined): string | undefined => {
  if (!isSchemaObject(schema)) return undefined
  const description = schema.description
  return typeof description === 'string' && description.trim() ? description.trim() : undefined
}

export const schemaAtPath = (schema: DagJsonSchema, path: string): DagJsonSchema | null => {
  if (!path) return schema
  const parts = path.split('.').filter(Boolean)
  let cur: DagJsonSchema = schema

  for (const rawPart of parts) {
    const part = rawPart.endsWith('[]') ? rawPart.slice(0, -2) : rawPart
    if (!isSchemaObject(cur)) return null

    if (cur.type === 'array' || 'items' in cur) {
      const items = cur.items
      if (!items || Array.isArray(items)) return null
      cur = items as DagJsonSchema
      if (rawPart.endsWith('[]')) continue
    }

    const curRecord = cur as Record<string, unknown>
    const properties = curRecord.properties
    if (!isObjectRecord(properties)) return null
    const next = properties[part] as DagJsonSchema | undefined
    if (!isSchemaObject(next)) return null
    cur = next
  }

  return cur
}

export const schemaArrayElement = (schema: DagJsonSchema): DagJsonSchema | null => {
  if (!isSchemaObject(schema) || !('items' in schema)) return null
  const items = schema.items
  if (!items || Array.isArray(items)) return null
  return items as DagJsonSchema
}

export const combineObjectSchemas = (left: DagJsonSchema, right: DagJsonSchema): DagJsonSchema => {
  const leftObj = isObjectRecord(left) ? left : {}
  const rightObj = isObjectRecord(right) ? right : {}
  return {
    type: 'object',
    properties: {
      ...(isObjectRecord(leftObj.properties) ? leftObj.properties : {}),
      ...(isObjectRecord(rightObj.properties) ? rightObj.properties : {}),
    },
    required: [
      ...new Set([
        ...(Array.isArray(leftObj.required) ? (leftObj.required as string[]) : []),
        ...(Array.isArray(rightObj.required) ? (rightObj.required as string[]) : []),
      ]),
    ],
    additionalProperties: false,
  }
}

export const optionalSchema = (schema: DagJsonSchema): DagJsonSchema => schema

export const oneOfSchema = (schemas: DagJsonSchema[]): DagJsonSchema => {
  if (schemas.length === 0) return {}
  if (schemas.length === 1) return schemas[0]!
  return { anyOf: schemas }
}
