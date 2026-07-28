import { createNode, explode, oneOf, type DagExposedInputDef, type DagNode } from './dagCore.ts'
import type { DagJsonSchema } from './dagSchema.ts'
import {
  recordInputsToRuntimeInputs,
  type DagNodeRecord,
  type DagNodeRunFunction,
} from './dagNodeRecord.ts'
import { defineFrpServiceProtocol } from '@taskyon/common/modules/frpBus'
import {
  createSandboxProtocolClient,
  serveFrpSandboxCapability,
} from '@taskyon/common/modules/sandbox/frpSandbox'
import { createExecutableSandbox } from '@taskyon/common/modules/sandbox/workerSandbox'
import { z } from 'zod'

const dagNodeUseProtocol = defineFrpServiceProtocol({
  service: 'dagNodeUse',
  version: '1',
  commands: {
    resolve: {
      request: z.object({
        alias: z.string(),
        params: z.record(z.string(), z.unknown()).optional(),
      }),
      response: z.unknown(),
    },
  },
})

const buildSandboxRunModule = (runCode: string): string => {
  const createProtocolClientSource = createSandboxProtocolClient.toString()
  return `
    (function () {
      const createProtocolClient = ${createProtocolClientSource};
      const run = ${runCode};
      return async function (params, aliases, sandboxApi) {
        if (!sandboxApi.port) throw new Error('DAG input protocol port is unavailable');
        const client = createProtocolClient(
          sandboxApi.port,
          'dagNodeUse',
          sandboxApi.signal,
        );
        const use = Object.fromEntries(
          aliases.map((alias) => [
            alias,
            (inputParams) => client.call('resolve', {
              alias,
              ...(inputParams === undefined ? {} : { params: inputParams }),
            }),
          ]),
        );
        return await run({ params, use });
      };
    })()
  `
}

const createTimeoutSignal = (
  id: string,
  timeoutMs: number,
): { signal: AbortSignal; dispose: () => void } => {
  const controller = new AbortController()
  const timeout = globalThis.setTimeout(() => {
    controller.abort(`DAG node ${id} timed out after ${timeoutMs}ms`)
  }, timeoutMs)
  return { signal: controller.signal, dispose: () => globalThis.clearTimeout(timeout) }
}

export const executeDagNodeRun = async (args: {
  id: string
  timeoutMs?: number
  runCode?: string
  run: DagNodeRunFunction | undefined
  params: Record<string, unknown>
  use: Record<string, (params?: Record<string, unknown>) => Promise<unknown>>
}) => {
  const timeoutMs = Math.max(100, Math.min(args.timeoutMs ?? 5_000, 60_000))
  const timeout = createTimeoutSignal(args.id, timeoutMs)
  try {
    if (args.run) {
      return await args.run({
        params: args.params,
        use: args.use,
      })
    }
    if (!args.runCode) throw new Error(`DAG node ${args.id}: missing runCode`)
    const aliases = Object.keys(args.use)
    const moduleId = `dag-node-${args.id}`
    const sandbox = await createExecutableSandbox({
      id: moduleId,
      reuse: { mode: 'immutable', contentId: args.id },
    })
    await sandbox.installModule(
      moduleId,
      buildSandboxRunModule(args.runCode),
      `${args.id}.dag-node.js`,
    )
    const capability = await serveFrpSandboxCapability({
      sandbox,
      protocol: dagNodeUseProtocol,
      signal: timeout.signal,
      handlers: {
        dagNodeUse: {
          resolve: async ({ alias, params }) => {
            const resolveInput = args.use[alias]
            if (!resolveInput) throw new Error(`DAG node ${args.id}: unknown input alias ${alias}`)
            return await resolveInput(params)
          },
        },
      },
    })
    try {
      return await sandbox.executeModule(moduleId, [args.params, aliases], {
        signal: timeout.signal,
        sourceURL: `${args.id}.dag-node.js`,
        channel: capability.channel,
      })
    } finally {
      capability.destroy()
    }
  } finally {
    timeout.dispose()
  }
}

export const createLazyDagUse = (
  runtimeInputs: ReturnType<typeof recordInputsToRuntimeInputs>,
  use: Record<string, (params?: Record<string, unknown>) => Promise<unknown>>,
): Record<string, (params?: Record<string, unknown>) => Promise<unknown>> => {
  const exposedAliases = new Set(Object.keys(runtimeInputs.exposedInputs))
  return Object.fromEntries(
    Object.entries(use).map(([alias, runner]) => [
      alias,
      async (inputParams?: Record<string, unknown>) =>
        await runner(inputParams ?? (exposedAliases.has(alias) ? undefined : {})),
    ]),
  )
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

  if (args.record.structure?.kind === 'explode') {
    const { sourceAlias, path } = args.record.structure
    const sourceNode = hiddenInputs[sourceAlias]
    if (!sourceNode) {
      throw new Error(
        `DAG node ${args.record.id}: explode source alias "${sourceAlias}" must be an internal input`,
      )
    }
    if (Object.keys(hiddenInputs).length !== 1 || Object.keys(exposedInputs).length !== 0) {
      throw new Error(
        `DAG node ${args.record.id}: explode nodes require exactly one internal input`,
      )
    }
    return explode(sourceNode, path, {
      name: args.record.id,
      localName: args.record.localName,
      contentHash: args.record.id,
      version: args.record.version,
      outputSchema: args.record.outputSchema,
    })
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
    description: args.record.label,
    contentHash: args.record.id,
    version: args.record.version,
    localParams: args.record.localParamsSchema,
    outputSchema: args.record.outputSchema,
    hiddenInputs,
    exposedInputs,
    policy: { cache: 'ReadWrite', scope: 'ModelState' },
    run: async (params, use) => {
      return await executeDagNodeRun({
        id: args.record.id,
        ...(typeof args.record.timeoutMs === 'number' ? { timeoutMs: args.record.timeoutMs } : {}),
        ...(args.record.runCode ? { runCode: args.record.runCode } : {}),
        run: args.record.run,
        params,
        use: createLazyDagUse(runtimeInputs, use),
      })
    },
  })
}
