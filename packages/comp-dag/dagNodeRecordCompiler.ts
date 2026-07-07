import { createNode, oneOf, type DagExposedInputDef, type DagNode } from './dagCore.ts'
import type { DagJsonSchema } from './dagSchema.ts'
import {
  recordInputsToRuntimeInputs,
  type DagNodeRecord,
  type DagNodeRunFunction,
} from './dagNodeRecord.ts'
import { executeInWorkerSandbox } from '@taskyon/common/modules/sandbox/workerSandbox.ts'

const createTimeoutSignal = (timeoutMs: number): { signal: AbortSignal; dispose: () => void } => {
  const controller = new AbortController()
  const timeout = globalThis.setTimeout(() => {
    controller.abort(`DAG node ${timeoutMs}ms timeout`)
  }, timeoutMs)
  return { signal: controller.signal, dispose: () => globalThis.clearTimeout(timeout) }
}

const executeNodeRecord = async (args: {
  record: Pick<DagNodeRecord, 'id' | 'timeoutMs' | 'run' | 'runCode'>
  run: DagNodeRunFunction | undefined
  params: Record<string, unknown>
  inputs: Record<string, unknown>
}) => {
  const timeoutMs = Math.max(100, Math.min(args.record.timeoutMs ?? 5_000, 60_000))
  const timeout = createTimeoutSignal(timeoutMs)
  try {
    if (args.run) {
      return await args.run({
        params: args.params,
        inputs: args.inputs,
      })
    }
    if (!args.record.runCode) throw new Error(`DAG node ${args.record.id}: missing runCode`)
    return await executeInWorkerSandbox(
      {
        id: `dag-node-${args.record.id}`,
        code: args.record.runCode,
        sourceURL: `${args.record.id}.dag-node.js`,
        stopSignal: timeout.signal,
      },
      { params: args.params, inputs: args.inputs },
    )
  } finally {
    timeout.dispose()
  }
}

export const compileDagNodeRecord = (args: {
  record: DagNodeRecord
  nodeById: Record<string, DagNode>
}): DagNode => {
  const runtimeInputs = recordInputsToRuntimeInputs(args.record)
  const hiddenInputs: Record<string, DagNode> = {}
  for (const [alias, ref] of Object.entries(runtimeInputs.hiddenInputs)) {
    const node = args.nodeById[ref.nodeId]
    if (!node)
      throw new Error(`DAG node ${args.record.id}: missing hidden input node ${ref.nodeId}`)
    hiddenInputs[alias] = node
  }

  const exposedInputs: Record<string, DagExposedInputDef> = {}
  for (const [alias, ref] of Object.entries(runtimeInputs.exposedInputs)) {
    if ('kind' in ref) {
      const nodes = ref.nodeIds.map((id) => {
        const node = args.nodeById[id]
        if (!node) throw new Error(`DAG node ${args.record.id}: missing exposed input node ${id}`)
        return node
      })
      exposedInputs[alias] = oneOf(nodes)
    } else {
      const node = args.nodeById[ref.nodeId]
      if (!node)
        throw new Error(`DAG node ${args.record.id}: missing exposed input node ${ref.nodeId}`)
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
    name: args.record.id,
    localName: args.record.localName,
    contentHash: args.record.id,
    version: args.record.version,
    localParams: args.record.localParamsSchema,
    outputSchema: args.record.outputSchema,
    hiddenInputs,
    exposedInputs,
    policy: { cache: 'ReadWrite', scope: 'ModelState' },
    run: async (params, use) => {
      const resolvedInputs: Record<string, unknown> = {}
      const exposedAliases = new Set(Object.keys(runtimeInputs.exposedInputs))
      for (const [alias, runner] of Object.entries(use)) {
        resolvedInputs[alias] = exposedAliases.has(alias) ? await runner() : await runner({})
      }
      return await executeNodeRecord({
        record: args.record,
        run: args.record.run,
        params,
        inputs: resolvedInputs,
      })
    },
  })
}
