import z from 'zod'
import { createNode, oneOf } from './dagCore'
import { executeInWorkerSandbox } from '../modules/sandbox/workerSandbox'

type JsonSchema = {
  type?: string | string[]
  properties?: Record<string, JsonSchema>
  items?: JsonSchema
  required?: string[]
  enum?: unknown[]
  const?: unknown
  default?: unknown
  nullable?: boolean
  additionalProperties?: boolean | JsonSchema
}

export type DynamicNodeInputRefSingle = { nodeId: string }
export type DynamicNodeInputRefOneOf = {
  kind: 'oneOf'
  nodeIds: string[]
}
export type DynamicDagNodeDefinition = {
  id: string
  label: string
  version: number
  timeoutMs?: number
  runCode: string
  localParamsSchema: JsonSchema
  outputSchema: JsonSchema
  hiddenInputs?: Record<string, DynamicNodeInputRefSingle>
  exposedInputs?: Record<string, DynamicNodeInputRefSingle | DynamicNodeInputRefOneOf>
}

export type DynamicLegacyNodeDefinition = {
  id: string
  label: string
  version: number
  timeoutMs?: number
  code: string
  input: Record<string, unknown>
}

export type DynamicAnyNodeDefinition = DynamicDagNodeDefinition | DynamicLegacyNodeDefinition

const asArray = <T>(v: T | T[] | undefined): T[] =>
  Array.isArray(v) ? v : v === undefined ? [] : [v]

const toZod = (schema: JsonSchema | undefined): z.ZodTypeAny => {
  const s = schema ?? {}
  if (s.const !== undefined) return z.literal(s.const as never)
  if (Array.isArray(s.enum) && s.enum.length > 0) {
    if (s.enum.length === 1) return z.literal(s.enum[0] as never)
    const values = s.enum.map((x) => z.literal(x as never))
    return z.union(values as unknown as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]])
  }

  const types = asArray(s.type)
  let base: z.ZodTypeAny
  if (types.includes('object') || (!s.type && (s.properties || s.additionalProperties))) {
    if (s.properties) {
      const required = new Set(s.required ?? [])
      const shape: Record<string, z.ZodTypeAny> = {}
      for (const [key, child] of Object.entries(s.properties)) {
        const zChild = toZod(child)
        shape[key] = required.has(key) ? zChild : zChild.optional()
      }
      base = z.object(shape)
    } else if (s.additionalProperties && typeof s.additionalProperties === 'object') {
      base = z.record(z.string(), toZod(s.additionalProperties))
    } else {
      base = z.record(z.string(), z.unknown())
    }
  } else if (types.includes('array') || s.items) {
    base = z.array(toZod(s.items))
  } else if (types.includes('number') || types.includes('integer')) {
    base = z.number()
  } else if (types.includes('boolean')) {
    base = z.boolean()
  } else if (types.includes('string')) {
    base = z.string()
  } else {
    base = z.unknown()
  }

  if (s.nullable || types.includes('null')) base = base.nullable()
  if (s.default !== undefined) base = base.default(s.default as never)
  return base
}

const toObjectZod = (schema: JsonSchema): z.ZodObject<z.ZodRawShape> => {
  const zod = toZod(schema)
  if (zod instanceof z.ZodObject) return zod
  return z.object({ value: zod.optional() })
}

const createTimeoutSignal = (timeoutMs: number): { signal: AbortSignal; dispose: () => void } => {
  const controller = new AbortController()
  const timeout = globalThis.setTimeout(() => {
    controller.abort(`Dynamic node timed out after ${timeoutMs}ms`)
  }, timeoutMs)
  return { signal: controller.signal, dispose: () => globalThis.clearTimeout(timeout) }
}

const normalizeLegacy = (def: DynamicLegacyNodeDefinition): DynamicDagNodeDefinition => {
  const base: DynamicDagNodeDefinition = {
    id: def.id,
    label: def.label,
    version: def.version,
    runCode: `(ctx) => ({ value: (${def.code})(ctx.params.input) })`,
    localParamsSchema: {
      type: 'object',
      properties: {
        input: {
          type: 'object',
          additionalProperties: true,
          default: def.input ?? {},
        },
      },
      required: ['input'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        value: {},
      },
      required: ['value'],
    },
  }
  if (typeof def.timeoutMs === 'number') base.timeoutMs = def.timeoutMs
  return base
}

const isLegacy = (def: DynamicAnyNodeDefinition): def is DynamicLegacyNodeDefinition =>
  'code' in def && !('runCode' in def)

export const normalizeDynamicDefinition = (
  def: DynamicAnyNodeDefinition,
): DynamicDagNodeDefinition => (isLegacy(def) ? normalizeLegacy(def) : def)

export const compileDynamicDagNode = (args: {
  definition: DynamicAnyNodeDefinition
  nodeById: Record<string, unknown>
}) => {
  const definition = normalizeDynamicDefinition(args.definition)
  const hiddenInputs: Record<string, unknown> = {}
  for (const [alias, ref] of Object.entries(definition.hiddenInputs ?? {})) {
    if (!('nodeId' in ref))
      throw new Error(
        `Dynamic node ${definition.id}: hidden input "${alias}" must be single node reference`,
      )
    const node = args.nodeById[ref.nodeId]
    if (!node)
      throw new Error(`Dynamic node ${definition.id}: missing hidden input node ${ref.nodeId}`)
    hiddenInputs[alias] = node
  }
  const exposedInputs: Record<string, unknown> = {}
  for (const [alias, ref] of Object.entries(definition.exposedInputs ?? {})) {
    if ('kind' in ref && ref.kind === 'oneOf') {
      const nodes = ref.nodeIds.map((id) => {
        const node = args.nodeById[id]
        if (!node)
          throw new Error(`Dynamic node ${definition.id}: missing exposed input node ${id}`)
        return node as never
      })
      exposedInputs[alias] = oneOf(nodes)
    } else {
      if (!('nodeId' in ref)) {
        throw new Error(`Dynamic node ${definition.id}: exposed input "${alias}" must have nodeId`)
      }
      const node = args.nodeById[ref.nodeId]
      if (!node)
        throw new Error(`Dynamic node ${definition.id}: missing exposed input node ${ref.nodeId}`)
      exposedInputs[alias] = node
    }
  }

  return createNode({
    name: definition.id,
    version: definition.version,
    localParams: toObjectZod(definition.localParamsSchema),
    outputSchema: toZod(definition.outputSchema),
    hiddenInputs: hiddenInputs as never,
    exposedInputs: exposedInputs as never,
    policy: { cache: 'ReadWrite', scope: 'ModelState' },
    run: async (params, use) => {
      const resolvedInputs: Record<string, unknown> = {}
      for (const [alias, runner] of Object.entries(
        use as Record<string, (params: Record<string, unknown>) => Promise<unknown>>,
      )) {
        resolvedInputs[alias] = await runner({})
      }
      const timeoutMs = Math.max(100, Math.min(definition.timeoutMs ?? 5_000, 60_000))
      const timeout = createTimeoutSignal(timeoutMs)
      try {
        return await executeInWorkerSandbox(
          {
            id: `dynamic-node-${definition.id}`,
            code: definition.runCode,
            sourceURL: `${definition.id}.dynamic.js`,
            stopSignal: timeout.signal,
          },
          { params, inputs: resolvedInputs },
        )
      } finally {
        timeout.dispose()
      }
    },
  })
}
