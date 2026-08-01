import {
  createNode,
  explode,
  oneOf,
  type DagExposedInputDef,
  type DagInputAccessor,
  type DagNode,
  type DagQueryBinding,
} from './dagCore.ts'
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
    query: {
      request: z.object({
        alias: z.string(),
        bindings: z
          .record(
            z.string(),
            z.union([
              z.object({ source: z.literal('row'), path: z.string().optional() }),
              z.object({ source: z.literal('rowKey'), path: z.string().optional() }),
              z.object({ source: z.literal('rows') }),
              z.object({ source: z.literal('value'), value: z.unknown() }),
            ]),
          )
          .optional(),
        operation: z.enum([
          'collect',
          'min',
          'max',
          'argmin',
          'argmax',
          'mean',
          'sum',
          'map',
          'apply',
        ]),
        path: z.string().optional(),
        slice: z.record(z.string(), z.unknown()),
        targetAlias: z.string().optional(),
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
        const use = Object.fromEntries(aliases.map((alias) => {
          const input = (inputParams) => client.call('resolve', {
              alias,
              ...(inputParams === undefined ? {} : { params: inputParams }),
            });
          Object.defineProperty(input, 'alias', { value: alias });
          input.slice = (slice) => {
            const query = (operation, extras) => client.call('query', {
              alias,
              operation,
              slice,
              ...(extras || {}),
            });
            return {
              collect: () => query('collect'),
              min: (path) => query('min', { path }),
              max: (path) => query('max', { path }),
              argmin: (path) => query('argmin', { path }),
              argmax: (path) => query('argmax', { path }),
              mean: (path) => query('mean', { path }),
              sum: (path) => query('sum', { path }),
              map: (target, bindings) =>
                query('map', { bindings, targetAlias: target.alias }),
              apply: (target, bindings) =>
                query('apply', { bindings, targetAlias: target.alias }),
            };
          };
          return [alias, input];
        }));
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
  use: Record<string, DagInputAccessor>
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
            return params === undefined ? await resolveInput() : await resolveInput(params)
          },
          query: async ({ alias, bindings, operation, path, slice, targetAlias }) => {
            const resolveInput = args.use[alias]
            if (!resolveInput) throw new Error(`DAG node ${args.id}: unknown input alias ${alias}`)
            const query = resolveInput.slice(slice)
            if (operation === 'collect') return await query.collect()
            if (
              operation === 'min' ||
              operation === 'max' ||
              operation === 'argmin' ||
              operation === 'argmax' ||
              operation === 'mean' ||
              operation === 'sum'
            ) {
              if (!path) {
                throw new Error(`DAG node ${args.id}: query operation ${operation} requires a path`)
              }
              return await query[operation](path)
            }
            if (!targetAlias || !bindings) {
              throw new Error(
                `DAG node ${args.id}: query operation ${operation} requires a target and bindings`,
              )
            }
            const target = args.use[targetAlias]
            if (!target) {
              throw new Error(`DAG node ${args.id}: unknown query target alias ${targetAlias}`)
            }
            return operation === 'map'
              ? await query.map(target, bindings as Record<string, DagQueryBinding>)
              : await query.apply(target, bindings as Record<string, DagQueryBinding>)
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
  use: Record<string, DagInputAccessor>,
): Record<string, DagInputAccessor> => {
  const exposedAliases = new Set(Object.keys(runtimeInputs.exposedInputs))
  return Object.fromEntries(
    Object.entries(use).map(([alias, runner]) => {
      const run = async (inputParams?: Record<string, unknown>) =>
        inputParams === undefined && exposedAliases.has(alias)
          ? await runner()
          : await runner(inputParams ?? {})
      const accessor = run as DagInputAccessor
      Object.defineProperty(accessor, 'alias', { enumerable: true, value: alias })
      accessor.slice = (slice) => runner.slice(slice)
      return [alias, accessor]
    }),
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
