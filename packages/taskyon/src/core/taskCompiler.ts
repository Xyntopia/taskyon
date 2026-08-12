import type { TaskNode, partialTaskDraft } from '../types/taskNode'
import { createSubtasksResult, taskResult } from '../types/toolApi'
import { createTaskNode } from './createTasks'
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
