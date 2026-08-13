import type { TaskNode, TaskGetter } from '../types/taskNode'
import { FunctionArguments, type FunctionCall } from '../types/tools'
import { sha256UrlSafeHash } from '../utils/encoding'
import type { ToolManager } from './toolManager'
import type { ToolRpcFunctionCallMessage } from './toolRpc'
import { materializeTaskyonFunctionArguments } from './taskVariables'
import {
  compileScopedToolDefinition,
  findScopedToolDefinition,
  scopedToolIdentity,
  validateToolArguments,
} from './scopedTools'
import { createWithDefaults } from './tools'

export function findCallingToolReference(taskChain: TaskNode[], currentToolName: string) {
  const caller = [...taskChain]
    .reverse()
    .find(
      (task) => task.content.type === 'functioncall' && task.content.data.name !== currentToolName,
    )
  if (caller?.content.type !== 'functioncall') return null
  return {
    taskId: caller.id,
    name: caller.content.data.name,
    ...(caller.content.data.toolRevision ? { revision: caller.content.data.toolRevision } : {}),
  }
}

type InvocationCall = Pick<ToolRpcFunctionCallMessage, 'taskId' | 'toolRevision'>

export const createInvocationToolResolver = (dependencies: {
  getExecutionTask: TaskGetter
  getTaskLineage: (taskId: string) => Promise<TaskNode[]>
  resolveRegisteredTool: ToolManager['resolveTool']
}) => {
  const resolveScopedInvocationTool = async (name: string, taskId: string) => {
    const executionTask = await dependencies.getExecutionTask(taskId)
    if (
      executionTask?.content.type !== 'functioncall' ||
      executionTask.content.data.name !== name
    ) {
      return undefined
    }
    const taskChain = await dependencies.getTaskLineage(taskId)
    const scoped = findScopedToolDefinition(taskChain, name)
    if (!scoped) return undefined
    const compiled = await compileScopedToolDefinition(
      scoped.tool,
      dependencies.resolveRegisteredTool,
    )
    return { ...scoped, tool: compiled.tool }
  }

  return async (name: string, call?: InvocationCall) => {
    if (call?.taskId) {
      const scoped = await resolveScopedInvocationTool(name, call.taskId)
      if (scoped) {
        const identity = scopedToolIdentity(scoped.definitionTask, scoped.tool.name)
        if (call.toolRevision && call.toolRevision !== identity.revision) {
          throw new Error(`Scoped tool revision mismatch for ${name}.`)
        }
        return {
          source: 'task-tree' as const,
          ...scoped,
          identity,
        }
      }
    }

    const registered = await dependencies.resolveRegisteredTool(name, call?.toolRevision)
    return {
      source: 'registry' as const,
      ...registered,
    }
  }
}

export type InvocationToolResolver = ReturnType<typeof createInvocationToolResolver>

export const prepareInvocationToolCall = async (
  call: ToolRpcFunctionCallMessage,
  dependencies: {
    resolveInvocationTool: InvocationToolResolver
    getTaskById: TaskGetter
    resolveToolSettings: (
      name: string,
      toolRevision: NonNullable<FunctionCall['toolRevision']>,
      settingsRevision: NonNullable<FunctionCall['settingsRevision']>,
    ) => Promise<FunctionArguments | undefined>
  },
): Promise<FunctionCall> => {
  if (call.taskId && !call.toolRevision) {
    throw new Error(`Persisted tool call is missing a tool revision: ${call.functionName}.`)
  }
  const { tool, identity } = await dependencies.resolveInvocationTool(call.functionName, call)
  if (!tool) {
    throw new Error(
      `The function '${call.functionName}' is not available in tools. Please select a valid toolname.`,
    )
  }
  const persistedArguments = call.arguments ?? {}
  const materializedArguments = await materializeTaskyonFunctionArguments(persistedArguments, {
    surface: 'execution',
    getTaskById: dependencies.getTaskById,
  })
  const settings =
    call.settingsRevision && identity
      ? await dependencies.resolveToolSettings(
          call.functionName,
          identity.revision,
          call.settingsRevision,
        )
      : undefined
  if (call.settingsRevision && !settings) {
    throw new Error(`Tool settings revision mismatch for ${call.functionName}.`)
  }
  const argumentsForExecution = FunctionArguments.parse({
    ...createWithDefaults(tool.parameters),
    ...(settings ?? {}),
    ...persistedArguments,
    ...materializedArguments,
  })
  validateToolArguments(
    call.functionName,
    tool.parameters,
    argumentsForExecution,
    Object.keys(settings ?? {}),
  )
  return {
    name: call.functionName,
    ...(identity ? { toolRevision: identity.revision } : {}),
    ...(call.settingsRevision ? { settingsRevision: call.settingsRevision } : {}),
    arguments: argumentsForExecution,
  }
}

export async function generateSecretId(
  taskId: string | undefined,
  tool: { name: string; code?: unknown; function?: unknown },
) {
  const revision =
    taskId ??
    (await sha256UrlSafeHash({
      name: tool.name,
      code: tool.code,
      functionSource: typeof tool.function === 'function' ? tool.function.toString() : undefined,
    }))
  const readableId = `${tool.name}:${revision}`
  return readableId.length <= 64 ? readableId : `tool:${await sha256UrlSafeHash(readableId)}`
}
