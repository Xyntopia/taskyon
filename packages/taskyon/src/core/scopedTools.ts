import type { JSONSchema7, JSONSchema7Definition } from 'json-schema'
import type { TaskNode, ScopedToolDefinition, partialTaskDraft } from '../types/taskNode'
import type { InternalTool } from '../types/toolApi'
import { toolCall } from '../types/toolApi'
import { ContentHash, type ToolBase, type ToolIdentity } from '../types/tools'
import { taskContentHash } from './createTasks'
import type { ToolManager } from './toolManager'
import Ajv from 'ajv'
import type { InvocationRevisionResolver } from './toolSettings'

const mergePublicParameter = (
  name: string,
  base: JSONSchema7Definition | undefined,
  patch: JSONSchema7,
): JSONSchema7Definition => {
  if (base === undefined) throw new Error(`Binding exposes unknown target parameter "${name}".`)
  if (typeof base === 'boolean') {
    if (Object.keys(patch).length > 0) {
      throw new Error(`Binding cannot patch boolean target parameter schema "${name}".`)
    }
    return base
  }
  return { ...base, ...patch }
}

export const deriveBindingParameters = (
  definition: Extract<ScopedToolDefinition, { implementation: unknown }>,
  target: ToolBase,
): JSONSchema7 => {
  if (target.parameters.type !== 'object') {
    throw new Error(`Binding target "${target.name}" must use an object parameter schema.`)
  }
  const selected = definition.implementation.publicArguments
  const properties = Object.fromEntries(
    Object.entries(selected).map(([name, patch]) => [
      name,
      mergePublicParameter(name, target.parameters.properties?.[name], patch),
    ]),
  )
  const required = (target.parameters.required ?? []).filter((name) =>
    Object.hasOwn(selected, name),
  )
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    ...(required.length > 0 ? { required } : {}),
  }
}

export const compileScopedToolDefinition = async (
  definition: ScopedToolDefinition,
  resolveTarget: (
    name: string,
    revision?: ContentHash,
  ) => Promise<{
    tool?: InternalTool
    identity?: ToolIdentity
  }>,
): Promise<{ tool: InternalTool; targetRevision?: ContentHash }> => {
  if ('code' in definition) return { tool: definition }
  const implementation = definition.implementation
  const resolved = await resolveTarget(implementation.target, implementation.targetRevision)
  if (!resolved.tool) throw new Error(`Binding target not found: ${implementation.target}`)
  const targetRevision = implementation.targetRevision ?? resolved.identity?.revision
  const parameters = deriveBindingParameters(definition, resolved.tool)
  return {
    ...(targetRevision ? { targetRevision } : {}),
    tool: {
      name: definition.name,
      description: definition.description,
      parameters,
      ...(definition.longDescription ? { longDescription: definition.longDescription } : {}),
      ...(definition.renderOptions ? { renderOptions: definition.renderOptions } : {}),
      function: (params, context) =>
        context.createSubtasksResult(
          toolCall({
            name: implementation.target,
            arguments: { ...params, ...implementation.fixedArguments },
            ...(targetRevision ? { toolRevision: targetRevision } : {}),
          }),
        ),
    },
  }
}

export const findScopedToolDefinition = (taskChain: readonly TaskNode[], name: string) => {
  const definitionTask = taskChain.findLast(
    (task) => task.content.type === 'tooldefinition' && task.content.data.name === name,
  )
  if (definitionTask?.content.type !== 'tooldefinition') return undefined
  return {
    definitionTask,
    tool: definitionTask.content.data,
  }
}

export const scopedToolIdentity = (definitionTask: TaskNode, name: string): ToolIdentity => ({
  publisherId: 'task-tree',
  name,
  revision: ContentHash.parse(taskContentHash(definitionTask.content)),
})

export const validateToolArguments = (
  name: string,
  parameters: ToolBase['parameters'],
  args: unknown,
  allowedAdditionalArguments: readonly string[] = [],
) => {
  const validationParameters =
    parameters.type === 'object' && parameters.additionalProperties === false
      ? {
          ...parameters,
          properties: {
            ...parameters.properties,
            ...Object.fromEntries(allowedAdditionalArguments.map((argument) => [argument, true])),
          },
        }
      : parameters
  const ajv = new Ajv()
  const validate = ajv.compile(validationParameters as object)
  if (!validate(args)) {
    throw new Error(`Invalid arguments for tool "${name}": ${ajv.errorsText(validate.errors)}`)
  }
}

const prepareBindingDraft = async (
  task: partialTaskDraft,
  toolManager: ToolManager,
): Promise<partialTaskDraft> => {
  if (task.content.type !== 'tooldefinition' || !('implementation' in task.content.data))
    return task
  const implementation = task.content.data.implementation
  const target = await toolManager.resolveTool(implementation.target, implementation.targetRevision)
  if (!target.tool || !target.identity) {
    throw new Error(`Binding target not found: ${implementation.target}`)
  }
  deriveBindingParameters(task.content.data, target.tool)
  return {
    ...task,
    content: {
      ...task.content,
      data: {
        ...task.content.data,
        implementation: { ...implementation, targetRevision: target.identity.revision },
      },
    },
  }
}

const prepareFunctionCallDraft = async (
  task: partialTaskDraft,
  lineage: readonly TaskNode[],
  resolveInvocationRevisions: InvocationRevisionResolver,
): Promise<partialTaskDraft> => {
  if (task.content.type !== 'functioncall') return task
  const call = task.content.data
  const scoped = findScopedToolDefinition(lineage, call.name)
  const revisions = scoped
    ? { toolRevision: scopedToolIdentity(scoped.definitionTask, call.name).revision }
    : await resolveInvocationRevisions({
        name: call.name,
        ...(call.toolRevision ? { toolRevision: call.toolRevision } : {}),
        ...(call.settingsRevision ? { settingsRevision: call.settingsRevision } : {}),
      })
  if (!revisions) {
    throw new Error(`Cannot compile unresolved tool call: ${call.name}.`)
  }
  return {
    ...task,
    content: {
      ...task.content,
      data: {
        name: call.name,
        toolRevision: revisions.toolRevision,
        ...(revisions.settingsRevision ? { settingsRevision: revisions.settingsRevision } : {}),
        arguments: call.arguments,
      },
    },
  }
}

export const prepareToolTaskDraft = async (
  task: partialTaskDraft,
  lineage: readonly TaskNode[],
  toolManager: ToolManager,
  resolveInvocationRevisions: InvocationRevisionResolver,
): Promise<partialTaskDraft> => {
  const binding = await prepareBindingDraft(task, toolManager)
  return await prepareFunctionCallDraft(binding, lineage, resolveInvocationRevisions)
}
