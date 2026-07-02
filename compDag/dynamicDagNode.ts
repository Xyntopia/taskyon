import { createNode, oneOf, type DagExposedInputDef, type DagNode } from './dagCore.ts'
import type { DagJsonSchema } from './dagSchema.ts'
import { executeInWorkerSandbox } from '../modules/sandbox/workerSandbox.ts'

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
  runCode?: string
  run?: (ctx: { params: Record<string, unknown>; inputs: Record<string, unknown> }) => unknown
  localParamsSchema: DagJsonSchema
  outputSchema: DagJsonSchema
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
    runCode: `async (ctx) => ({ value: await (${def.code})(ctx.params.input) })`,
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

  return createNode<
    DagJsonSchema,
    DagJsonSchema,
    Record<string, DagNode>,
    Record<string, DagExposedInputDef>,
    Record<string, unknown>,
    unknown
  >({
    name: definition.id,
    version: definition.version,
    localParams: definition.localParamsSchema,
    outputSchema: definition.outputSchema,
    hiddenInputs: hiddenInputs as Record<string, DagNode>,
    exposedInputs: exposedInputs as Record<string, DagExposedInputDef>,
    policy: { cache: 'ReadWrite', scope: 'ModelState' },
    run: async (params: unknown, use: unknown) => {
      const resolvedInputs: Record<string, unknown> = {}
      const exposedAliases = new Set(Object.keys(definition.exposedInputs ?? {}))
      for (const [alias, runner] of Object.entries(
        use as Record<string, (params?: Record<string, unknown>) => Promise<unknown>>,
      )) {
        resolvedInputs[alias] = exposedAliases.has(alias) ? await runner() : await runner({})
      }
      const timeoutMs = Math.max(100, Math.min(definition.timeoutMs ?? 5_000, 60_000))
      const timeout = createTimeoutSignal(timeoutMs)
      try {
        if (definition.run) {
          return await definition.run({
            params: params as Record<string, unknown>,
            inputs: resolvedInputs,
          })
        }
        if (!definition.runCode) throw new Error(`Dynamic node ${definition.id}: missing runCode`)
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
