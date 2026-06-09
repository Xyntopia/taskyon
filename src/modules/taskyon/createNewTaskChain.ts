import type { partialTaskDraft, TaskNode } from '@taskyon/taskyon'

export type MessageExecutionMode = 'message' | 'websearch'

type BuildCreateNewTaskChainArgs = {
  currentTask: TaskNode | null | undefined
  draftTask: partialTaskDraft
  entryNode?: partialTaskDraft | undefined
  fileIds?: readonly string[] | undefined
  keyword?: string | null | undefined
  mode: MessageExecutionMode
}

const cloneTaskDraft = (task: partialTaskDraft): partialTaskDraft => {
  return structuredClone(task)
}

const withKeyword = (
  task: partialTaskDraft,
  keyword: string | null | undefined,
): partialTaskDraft => {
  if (!keyword) return task
  return { ...task, name: keyword }
}

export const createFileTaskDraft = (
  fileIds: readonly string[] | undefined,
): partialTaskDraft | undefined => {
  if (!fileIds?.length) return undefined
  return {
    role: 'system',
    content: {
      type: 'files',
      data: [...fileIds],
    },
  }
}

export const applyWebSearchIntent = (
  task: partialTaskDraft,
  mode: MessageExecutionMode,
): partialTaskDraft => {
  if (task.content.type !== 'functioncall') return task

  const previousArguments =
    task.content.data.arguments && typeof task.content.data.arguments === 'object'
      ? task.content.data.arguments
      : {}
  const previousWebSearch =
    'websearch' in previousArguments &&
    previousArguments.websearch &&
    typeof previousArguments.websearch === 'object'
      ? previousArguments.websearch
      : {}

  return {
    ...task,
    content: {
      ...task.content,
      data: {
        ...task.content.data,
        arguments: {
          ...previousArguments,
          websearch: {
            ...previousWebSearch,
            enabled: mode === 'websearch',
          },
        },
      },
    },
  }
}

export const buildCreateNewTaskChain = ({
  currentTask,
  draftTask,
  entryNode,
  fileIds,
  keyword,
  mode,
}: BuildCreateNewTaskChainArgs): partialTaskDraft[] => {
  const newTaskChain: partialTaskDraft[] = []
  const fileTask = createFileTaskDraft(fileIds)

  if (fileTask) {
    newTaskChain.push(withKeyword(fileTask, keyword))
  }

  newTaskChain.push(withKeyword(cloneTaskDraft(draftTask), keyword))

  if (draftTask.content.type === 'message' && entryNode) {
    newTaskChain.push(withKeyword(applyWebSearchIntent(cloneTaskDraft(entryNode), mode), keyword))
  }

  if (currentTask && currentTask.content.type !== 'return') {
    newTaskChain.unshift(
      withKeyword(
        {
          role: 'system',
          content: {
            type: 'return',
            data: 'Function was cancelled for unknown reasons.',
          },
        },
        keyword,
      ),
    )
  }

  return newTaskChain
}
