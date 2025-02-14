import { z } from 'zod'
import type { JSONSchema } from 'json-schema-to-ts'

/*
// in order to prevent a circular reference in zod, we need to define our JSONSchemaForFunctionParameter
// separately
// https://zod.dev/?id=recursive-types
// Base schema definition
// Base schema definition
// maybe we can use the "official" verison here from @types/json-schema
const baseSchema = z.object({
  $schema: z.string().optional(),
  $id: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  type: z.enum(['string', 'number', 'integer', 'boolean', 'array', 'object', 'null']).optional(),
  required: z.array(z.string()).optional(),
  enum: z.array(z.unknown()).optional(),
  const: z.unknown().optional(),
  format: z.string().optional(),
  default: z.unknown().optional(),
  additionalProperties: z.boolean().optional(),
})

// Define type separately and attach it to Zod in order to be able to do recursive type definitions...
type JSONSchemaForFunctionParameter = z.infer<typeof baseSchema> & {
  properties?: Record<string, JSONSchemaForFunctionParameter> | undefined
  items?: JSONSchemaForFunctionParameter | JSONSchemaForFunctionParameter[] | undefined
}
export const JSONSchemaForFunctionParameter: z.ZodType<JSONSchemaForFunctionParameter> =
  baseSchema.extend({
    properties: z
      .record(
        z.string(),
        z.lazy(() => JSONSchemaForFunctionParameter),
      )
      .optional(),
    items: z
      .union([
        z.lazy(() => JSONSchemaForFunctionParameter),
        z.lazy(() => JSONSchemaForFunctionParameter.array()),
      ])
      .optional(),
  })
*/

const JSONSchemaEnum = z.enum(['string', 'number', 'integer', 'boolean', 'object', 'array', 'null'])

const JSONSchemaObjectRaw = z
  .object({
    $id: z.string().optional(),
    $ref: z.string().optional(),
    $schema: z.string().optional(),
    $comment: z.string().optional(),
    type: z.union([JSONSchemaEnum, z.array(JSONSchemaEnum)]).optional(),
    const: z.any().optional(),
    enum: z.any().optional(),
    multipleOf: z.number().optional(),
    maximum: z.number().optional(),
    exclusiveMaximum: z.number().optional(),
    minimum: z.number().optional(),
    exclusiveMinimum: z.number().optional(),
    maxLength: z.number().optional(),
    minLength: z.number().optional(),
    pattern: z.string().optional(),
    items: z.union([z.lazy(() => JSONSchema), z.array(z.lazy(() => JSONSchema))]).optional(),
    additionalItems: z.lazy(() => JSONSchema).optional(),
    contains: z.lazy(() => JSONSchema).optional(),
    maxItems: z.number().optional(),
    minItems: z.number().optional(),
    uniqueItems: z.boolean().optional(),
    maxProperties: z.number().optional(),
    minProperties: z.number().optional(),
    required: z.array(z.string()).optional(),
    properties: z.record(z.lazy(() => JSONSchema)).optional(),
    patternProperties: z.record(z.lazy(() => JSONSchema)).optional(),
    additionalProperties: z.lazy(() => JSONSchema).optional(),
    unevaluatedProperties: z.lazy(() => JSONSchema).optional(),
    dependencies: z.record(z.union([z.lazy(() => JSONSchema), z.array(z.string())])).optional(),
    propertyNames: z.lazy(() => JSONSchema).optional(),
    if: z.lazy(() => JSONSchema).optional(),
    then: z.lazy(() => JSONSchema).optional(),
    else: z.lazy(() => JSONSchema).optional(),
    allOf: z.array(z.lazy(() => JSONSchema)).optional(),
    anyOf: z.array(z.lazy(() => JSONSchema)).optional(),
    oneOf: z.array(z.lazy(() => JSONSchema)).optional(),
    not: z.lazy(() => JSONSchema).optional(),
    format: z.string().optional(),
    contentMediaType: z.string().optional(),
    contentEncoding: z.string().optional(),
    definitions: z.record(z.lazy(() => JSONSchema)).optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    default: z.any().optional(),
    readOnly: z.boolean().optional(),
    writeOnly: z.boolean().optional(),
    examples: z.array(z.any()).optional(),
    nullable: z.boolean().optional(),
  })
  .strict()

export type JSONSchemaObjectSchema = Exclude<JSONSchema, boolean>
// This inline transform removes keys with undefined values.
const JSONSchemaObjectSchema: z.ZodType<JSONSchemaObjectSchema, z.ZodTypeDef, unknown> = z.lazy(
  () =>
    JSONSchemaObjectRaw.transform(
      (data) =>
        Object.fromEntries(
          Object.entries(data).filter(([, v]) => v !== undefined),
        ) as JSONSchemaObjectSchema,
    ),
)

// Extend the raw object first, then transform.
const JSONSchemaReferenceSchema: z.ZodType<JSONSchema, z.ZodTypeDef, unknown> =
  JSONSchemaObjectRaw.extend({
    $id: z.string(),
  }).transform(
    (data) =>
      Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)) as JSONSchema,
  )

// A JSONSchema can be a boolean or an object.
const JSONSchema: z.ZodType<JSONSchema, z.ZodTypeDef, unknown> = z.union([
  z.boolean(),
  JSONSchemaObjectSchema,
])

export { JSONSchema, JSONSchemaReferenceSchema, JSONSchemaObjectSchema }
