import { z } from 'zod'
import type { JSONSchema7, JSONSchema7Definition } from 'json-schema'

const JSONSchemaEnum = z.enum(['string', 'number', 'integer', 'boolean', 'object', 'array', 'null'])

// This inline transform removes keys with undefined values.
const JSONSchema7: z.ZodType<JSONSchema7> = z.lazy(() =>
  JSONSchemaObjectRaw.transform(
    (data) =>
      Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)) as JSONSchema7,
  ),
)

// A JSONSchema can be a boolean or an object.
const JSONSchema7Definition: z.ZodType<JSONSchema7Definition> = z.lazy(() =>
  z.union([z.boolean(), JSONSchema7]),
)

const JSONSchemaObjectRaw = z.strictObject({
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
  items: z.lazy(() => z.union([JSONSchema7Definition, z.array(JSONSchema7Definition)]).optional()),
  additionalItems: z.lazy(() => JSONSchema7Definition.optional()),
  contains: z.lazy(() => JSONSchema7Definition.optional()),
  maxItems: z.number().optional(),
  minItems: z.number().optional(),
  uniqueItems: z.boolean().optional(),
  maxProperties: z.number().optional(),
  minProperties: z.number().optional(),
  required: z.array(z.string()).optional(),
  properties: z.lazy(() => z.record(z.string(), JSONSchema7Definition).optional()),
  patternProperties: z.lazy(() => z.record(z.string(), JSONSchema7Definition).optional()),
  additionalProperties: z.lazy(() => JSONSchema7Definition.optional()),
  unevaluatedProperties: z.lazy(() => JSONSchema7Definition.optional()),
  dependencies: z.lazy(() =>
    z.record(z.string(), z.union([JSONSchema7Definition, z.array(z.string())])).optional(),
  ),
  propertyNames: z.lazy(() => JSONSchema7Definition.optional()),
  if: z.lazy(() => JSONSchema7Definition.optional()),
  then: z.lazy(() => JSONSchema7Definition.optional()),
  else: z.lazy(() => JSONSchema7Definition.optional()),
  allOf: z.lazy(() => z.array(z.lazy(() => JSONSchema7Definition)).optional()),
  anyOf: z.lazy(() => z.array(z.lazy(() => JSONSchema7Definition)).optional()),
  oneOf: z.lazy(() => z.array(z.lazy(() => JSONSchema7Definition)).optional()),
  not: z.lazy(() => JSONSchema7Definition.optional()),
  format: z.string().optional(),
  contentMediaType: z.string().optional(),
  contentEncoding: z.string().optional(),
  definitions: z
    .record(
      z.string(),
      z.lazy(() => JSONSchema7Definition),
    )
    .optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  default: z.any().optional(),
  readOnly: z.boolean().optional(),
  writeOnly: z.boolean().optional(),
  examples: z.array(z.any()).optional(),
  nullable: z.boolean().optional(),
})

// Extend the raw object first, then transform.
const JSONSchemaReferenceSchema: z.ZodType<JSONSchema7> = JSONSchemaObjectRaw.extend({
  $id: z.string(),
}).transform(
  (data) =>
    Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)) as JSONSchema7,
)

export { JSONSchema7Definition, JSONSchemaReferenceSchema, JSONSchema7 }
