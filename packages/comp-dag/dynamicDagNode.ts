import {
  createNode,
  oneOf,
  type DagExposedInputDef,
  type DagNode,
  type DagNodeEffect,
} from './dagCore.ts'
import type { Hash } from './caching.ts'
import type { DagJsonSchema } from './dagSchema.ts'
import { recordInputsToRuntimeInputs } from './dagNodeRecord.ts'
import type {
  DagNodeInputRefOneOf,
  DagNodeInputRefSingle,
  DagNodeRecord,
  DagNodeRecordInputRef,
  DagNodeRunFunction,
} from './dagNodeRecord.ts'
import { createLazyDagUse, executeDagNodeRun } from './dagNodeRecordCompiler.ts'

export type DynamicNodeInputRefSingle = DagNodeInputRefSingle
export type DynamicNodeInputRefOneOf = DagNodeInputRefOneOf
export type DynamicDagNodeInputRef = DagNodeRecordInputRef

type DynamicDagNodeInputRefMap = Record<string, DynamicDagNodeInputRef>

export type DynamicDagNodeDefinition = {
  id: string
  localName?: string
  contentHash?: Hash
  label: string
  version: number
  effect?: DagNodeEffect
  timeoutMs?: number
  runCode?: string
  runSource?: string
  run?: DagNodeRunFunction
  localParamsSchema: DagJsonSchema
  outputSchema: DagJsonSchema
  inputs?: DynamicDagNodeInputRefMap
  hiddenInputs?: Record<string, DynamicNodeInputRefSingle>
  exposedInputs?: Record<string, DynamicNodeInputRefSingle | DynamicNodeInputRefOneOf>
}
export type DynamicDagNodeRecord = DagNodeRecord

type DynamicExecutableDagNodeDefinition = {
  id: string
  localName?: string
  contentHash?: Hash
  label: string
  version: number
  effect?: DagNodeEffect
  timeoutMs?: number
  runCode?: string
  run?: DagNodeRunFunction
  localParamsSchema: DagJsonSchema
  outputSchema: DagJsonSchema
  inputs?: DynamicDagNodeInputRefMap
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

const normalizeLegacy = (def: DynamicLegacyNodeDefinition): DynamicExecutableDagNodeDefinition => {
  const base: DynamicExecutableDagNodeDefinition = {
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

const isHash = (value: string): value is Hash => value.startsWith('sha256:')

export const normalizeDynamicDefinition = (
  def: DynamicAnyNodeDefinition,
): DynamicExecutableDagNodeDefinition =>
  isLegacy(def)
    ? normalizeLegacy(def)
    : ({
        ...def,
        ...(def.contentHash
          ? { contentHash: def.contentHash }
          : isHash(def.id)
            ? { contentHash: def.id }
            : {}),
      } satisfies DynamicExecutableDagNodeDefinition)

export const compileDynamicDagNode = (args: {
  definition: DynamicAnyNodeDefinition
  nodeById: Record<string, unknown>
}) => {
  const definition = normalizeDynamicDefinition(args.definition)
  const inputRefs: Pick<DagNodeRecord, 'inputs' | 'hiddenInputs' | 'exposedInputs'> = {}
  if (definition.inputs) inputRefs.inputs = definition.inputs
  if (definition.hiddenInputs) inputRefs.hiddenInputs = definition.hiddenInputs
  if (definition.exposedInputs) inputRefs.exposedInputs = definition.exposedInputs
  const runtimeInputs = recordInputsToRuntimeInputs(inputRefs)
  const hiddenInputs: Record<string, unknown> = {}
  for (const [alias, ref] of Object.entries(runtimeInputs.hiddenInputs)) {
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
  for (const [alias, ref] of Object.entries(runtimeInputs.exposedInputs)) {
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

  const nodeConfig: Parameters<
    typeof createNode<
      DagJsonSchema,
      DagJsonSchema,
      Record<string, DagNode>,
      Record<string, DagExposedInputDef>,
      Record<string, unknown>,
      unknown
    >
  >[0] = {
    name: definition.id,
    version: definition.version,
    effect: definition.effect ?? 'pure',
    localParams: definition.localParamsSchema,
    outputSchema: definition.outputSchema,
    hiddenInputs: hiddenInputs as Record<string, DagNode>,
    exposedInputs: exposedInputs as Record<string, DagExposedInputDef>,
    policy: { cache: 'ReadWrite', scope: 'ModelState' },
    run: async (params, use) => {
      return await executeDagNodeRun({
        id: definition.id,
        ...(typeof definition.timeoutMs === 'number' ? { timeoutMs: definition.timeoutMs } : {}),
        ...(definition.runCode ? { runCode: definition.runCode } : {}),
        run: definition.run,
        params,
        use: createLazyDagUse(runtimeInputs, use),
      })
    },
  }
  if (definition.localName) nodeConfig.localName = definition.localName
  if (definition.contentHash) nodeConfig.contentHash = definition.contentHash

  return createNode<
    DagJsonSchema,
    DagJsonSchema,
    Record<string, DagNode>,
    Record<string, DagExposedInputDef>,
    Record<string, unknown>,
    unknown
  >(nodeConfig)
}

export const compileDagNodeRecord = (args: {
  record: DagNodeRecord
  nodeById: Record<string, unknown>
}) =>
  compileDynamicDagNode({
    definition: args.record,
    nodeById: args.nodeById,
  })
