import { z } from 'zod'
import { taskyon_class_metadata, taskyon_source_metadata } from 'rumoca-full-web'

export type MetadataExpression =
  | { kind: 'empty' | 'all' }
  | { kind: 'literal'; literal_type: string; text: string }
  | { kind: 'reference'; name: string }
  | { kind: 'call'; name: string; arguments: MetadataExpression[]; partial: boolean }
  | {
      kind: 'entry'
      name: string
      arguments: MetadataExpression[]
      value: MetadataExpression | null
    }
  | {
      kind: 'prefixed'
      value: MetadataExpression
      each: boolean
      final: boolean
      redeclare: boolean
    }
  | { kind: 'array'; elements: MetadataExpression[]; constructor: string }
  | { kind: 'tuple'; elements: MetadataExpression[] }
  | { kind: 'unary'; operator: string; value: MetadataExpression }
  | { kind: 'binary'; operator: string; left: MetadataExpression; right: MetadataExpression }
  | {
      kind: 'range'
      start: MetadataExpression
      step: MetadataExpression | null
      end: MetadataExpression
    }
  | {
      kind: 'if'
      branches: [MetadataExpression, MetadataExpression][]
      otherwise: MetadataExpression
    }
  | { kind: 'parenthesized'; value: MetadataExpression }
  | {
      kind: 'comprehension'
      value: MetadataExpression
      indices: [string, MetadataExpression][]
      filter: MetadataExpression | null
    }
  | { kind: 'index'; value: MetadataExpression; subscripts: MetadataExpression[] }
  | { kind: 'field'; value: MetadataExpression; name: string }

const expressionSchema: z.ZodType<MetadataExpression> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('empty') }),
    z.object({ kind: z.literal('all') }),
    z.object({ kind: z.literal('literal'), literal_type: z.string(), text: z.string() }),
    z.object({ kind: z.literal('reference'), name: z.string() }),
    z.object({
      kind: z.literal('call'),
      name: z.string(),
      arguments: expressionSchema.array(),
      partial: z.boolean(),
    }),
    z.object({
      kind: z.literal('entry'),
      name: z.string(),
      arguments: expressionSchema.array(),
      value: expressionSchema.nullable(),
    }),
    z.object({
      kind: z.literal('prefixed'),
      value: expressionSchema,
      each: z.boolean(),
      final: z.boolean(),
      redeclare: z.boolean(),
    }),
    z.object({
      kind: z.literal('array'),
      elements: expressionSchema.array(),
      constructor: z.string(),
    }),
    z.object({ kind: z.literal('tuple'), elements: expressionSchema.array() }),
    z.object({ kind: z.literal('unary'), operator: z.string(), value: expressionSchema }),
    z.object({
      kind: z.literal('binary'),
      operator: z.string(),
      left: expressionSchema,
      right: expressionSchema,
    }),
    z.object({
      kind: z.literal('range'),
      start: expressionSchema,
      step: expressionSchema.nullable(),
      end: expressionSchema,
    }),
    z.object({
      kind: z.literal('if'),
      branches: z.tuple([expressionSchema, expressionSchema]).array(),
      otherwise: expressionSchema,
    }),
    z.object({ kind: z.literal('parenthesized'), value: expressionSchema }),
    z.object({
      kind: z.literal('comprehension'),
      value: expressionSchema,
      indices: z.tuple([z.string(), expressionSchema]).array(),
      filter: expressionSchema.nullable(),
    }),
    z.object({
      kind: z.literal('index'),
      value: expressionSchema,
      subscripts: expressionSchema.array(),
    }),
    z.object({ kind: z.literal('field'), value: expressionSchema, name: z.string() }),
  ]),
)

const componentSchema = z.object({
  name: z.string(),
  type_name: z.string(),
  description: z.string(),
  variability: z.string(),
  annotation: expressionSchema.array(),
  modifiers: expressionSchema.array(),
  binding: expressionSchema.nullable(),
  dimensions: expressionSchema.array(),
})

export type ClassMetadata = {
  name: string
  qualified_name: string
  class_type: string
  description: string
  annotation: MetadataExpression[]
  components: Record<string, z.infer<typeof componentSchema>>
  extends: {
    base_name: string
    annotation: MetadataExpression[]
    modifiers: MetadataExpression[]
  }[]
  classes: Record<string, ClassMetadata>
  connections: { lhs: string; rhs: string }[]
}

const classSchema: z.ZodType<ClassMetadata> = z.lazy(() =>
  z.object({
    name: z.string(),
    qualified_name: z.string(),
    class_type: z.string(),
    description: z.string(),
    annotation: expressionSchema.array(),
    components: z.record(z.string(), componentSchema),
    extends: z
      .object({
        base_name: z.string(),
        annotation: expressionSchema.array(),
        modifiers: expressionSchema.array(),
      })
      .array(),
    classes: z.record(z.string(), classSchema),
    connections: z.object({ lhs: z.string(), rhs: z.string() }).array(),
  }),
)

const documentSchema = z.object({
  schema_version: z.literal(1),
  revision: z.string().nullable(),
  classes: z.record(z.string(), classSchema),
  connection_annotations_available: z.boolean(),
})

export function decodeClassMetadata(raw: string) {
  const value: unknown = JSON.parse(raw)
  return documentSchema.parse(value)
}

export function readSourceMetadata(source: string, filename: string) {
  return decodeClassMetadata(taskyon_source_metadata(source, filename))
}

export function readClassMetadata(qualifiedName: string): ClassMetadata {
  const document = decodeClassMetadata(taskyon_class_metadata(qualifiedName))
  const value = Object.values(document.classes).find(
    (entry) => entry.qualified_name === qualifiedName,
  )
  if (!value) throw new Error(`Metadata did not contain requested class: ${qualifiedName}`)
  return value
}

export function unwrapMetadata(value: MetadataExpression): MetadataExpression {
  return value.kind === 'prefixed' || value.kind === 'parenthesized'
    ? unwrapMetadata(value.value)
    : value
}
