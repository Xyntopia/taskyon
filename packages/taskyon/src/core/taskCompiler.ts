import type { TaskNode, partialTaskDraft } from '../types/taskNode'
import { createSubtasksResult, taskResult } from '../types/toolApi'
import { createTaskNode, ensureValidTaskId } from './createTasks'
import { prepareToolTaskDraft } from './scopedTools'
import type { ToolManager } from './toolManager'
import type { InvocationRevisionResolver } from './toolSettings'

export const compileTaskChain = async (
  drafts: readonly partialTaskDraft[],
  dependencies: {
    lineage: readonly TaskNode[]
    parentID?: string
    priorID?: string
    toolManager: ToolManager
    resolveInvocationRevisions: InvocationRevisionResolver
  },
): Promise<TaskNode[]> => {
  const compiled: TaskNode[] = []
  let priorID = dependencies.priorID

  for (const draft of drafts) {
    if (draft.id) {
      throw new Error(
        'Task compilation accepts drafts without ids. Verify completed tasks instead.',
      )
    }
    const linkedDraft = {
      ...draft,
      parentID: dependencies.parentID,
      priorID,
    }
    const prepared = await prepareToolTaskDraft(
      linkedDraft,
      [...dependencies.lineage, ...compiled],
      dependencies.toolManager,
      dependencies.resolveInvocationRevisions,
    )
    const task = await createTaskNode(prepared, { createMeta: 'missing' })
    compiled.push(task)
    priorID = task.id
  }

  return compiled
}

export const createTaskCompiler = (dependencies: {
  getTaskLineage: (id: string) => Promise<TaskNode[]>
  toolManager: ToolManager
  resolveInvocationRevisions: InvocationRevisionResolver
}) => {
  const compileDraftChain = async (
    drafts: readonly partialTaskDraft[],
    links: {
      parentID?: string | undefined
      priorID?: string | undefined
    } = {},
  ) => {
    const lineageId = links.priorID ?? links.parentID
    const lineage = lineageId ? await dependencies.getTaskLineage(lineageId) : []
    return await compileTaskChain(drafts, {
      lineage,
      ...(links.parentID !== undefined ? { parentID: links.parentID } : {}),
      ...(links.priorID !== undefined ? { priorID: links.priorID } : {}),
      toolManager: dependencies.toolManager,
      resolveInvocationRevisions: dependencies.resolveInvocationRevisions,
    })
  }

  const compileOrVerifyChain = async (
    tasks: readonly partialTaskDraft[],
    links: Parameters<typeof compileDraftChain>[1] = {},
  ) => {
    const suppliedIds = tasks.map((task) => task.id !== undefined)
    if (suppliedIds.some(Boolean) && !suppliedIds.every(Boolean)) {
      throw new Error('A task chain cannot mix completed task nodes with unhashed drafts.')
    }
    const rootTask = tasks[0]
    const effectiveLinks =
      links.parentID === undefined && links.priorID === undefined && rootTask
        ? {
            ...(rootTask.parentID !== undefined ? { parentID: rootTask.parentID } : {}),
            ...(rootTask.priorID !== undefined ? { priorID: rootTask.priorID } : {}),
          }
        : links
    return suppliedIds.every(Boolean)
      ? await Promise.all(tasks.map(ensureValidTaskId))
      : await compileDraftChain(tasks, effectiveLinks)
  }

  return { compileDraftChain, compileOrVerifyChain }
}

export type TaskCompiler = ReturnType<typeof createTaskCompiler>

export const createCompiledSubtasksResult = async (
  tasks: Parameters<typeof createSubtasksResult>[0],
  compileChain: (drafts: readonly partialTaskDraft[]) => Promise<TaskNode[]>,
) => {
  const result = createSubtasksResult(tasks)
  return taskResult.parse({
    ...result,
    taskChainList: await Promise.all(result.taskChainList.map(compileChain)),
  })
}
