import { forgeTaskChain } from './createTasks'
import type { FileAttachment, partialTaskDraft, TaskNode } from '../types/taskNode'
import { textRankTaskName } from './taskNaming'

export type MessageExecutionMode = 'message' | 'websearch'

type BuildCreateNewTaskChainArgs = {
  currentTask: TaskNode | null | undefined
  draftTask: partialTaskDraft
  entryNode?: partialTaskDraft | undefined
  fileAttachments?: readonly (FileAttachment | string)[] | undefined
  keyword?: string | null | undefined
  mode: MessageExecutionMode
}

type CreatedTaskChain = {
  taskChain: partialTaskDraft[]
  createdTasks: TaskNode[]
}

const cloneTaskDraft = (task: partialTaskDraft): partialTaskDraft => structuredClone(task)

const TASK_NAME_INPUT_WORD_LIMIT = 100

const firstWords = (text: string, maxWords: number) => text.trim().split(/\s+/).slice(0, maxWords)

const taskTextForName = (task: partialTaskDraft): string | null => {
  if (task.content.type === 'message' || task.content.type === 'return') return task.content.data
  if (task.content.type === 'functioncall') return task.content.data.name
  return null
}

const createTaskKeyword = (task: partialTaskDraft): string | null => {
  const text = taskTextForName(task)
  if (!text) return null
  return textRankTaskName(firstWords(text, TASK_NAME_INPUT_WORD_LIMIT).join(' '), {
    maxWords: 4,
    maxChars: 50,
  })
}

const withKeyword = (
  task: partialTaskDraft,
  keyword: string | null | undefined,
): partialTaskDraft => {
  if (!keyword) return task
  return { ...task, name: keyword }
}

export const createFileTaskDraft = (
  attachments: readonly (FileAttachment | string)[] | undefined,
): partialTaskDraft | undefined => {
  if (!attachments?.length) return undefined
  return {
    role: 'system',
    content: {
      type: 'files',
      data: [...attachments],
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
  fileAttachments,
  keyword,
  mode,
}: BuildCreateNewTaskChainArgs): partialTaskDraft[] => {
  const newTaskChain: partialTaskDraft[] = []
  const fileTask = createFileTaskDraft(fileAttachments)
  const generatedKeyword = keyword ?? createTaskKeyword(draftTask)

  if (fileTask) {
    newTaskChain.push(withKeyword(fileTask, generatedKeyword))
  }

  newTaskChain.push(withKeyword(cloneTaskDraft(draftTask), generatedKeyword))

  if (draftTask.content.type === 'message' && entryNode) {
    newTaskChain.push(
      withKeyword(applyWebSearchIntent(cloneTaskDraft(entryNode), mode), generatedKeyword),
    )
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
        generatedKeyword,
      ),
    )
  }

  return newTaskChain
}

export const createNewTaskChain = async ({
  priorTaskId,
  ...args
}: BuildCreateNewTaskChainArgs & {
  priorTaskId?: string | undefined
}): Promise<CreatedTaskChain> => {
  const taskChain = buildCreateNewTaskChain(args)
  const createdTasks = await forgeTaskChain([taskChain], [priorTaskId])
  return { taskChain, createdTasks }
}
