import { load } from 'js-yaml'
import z from 'zod'
import { createTaskNode, taskNodeToRecord } from './createTasks'
import { createTaskVariablePresentationService, TASK_REF_PREFIX } from './taskVariables'
import type { TaskNode } from '../types/taskNode'
import { partialTaskDraft } from '../types/taskNode'
import { deepCopy } from '../utils/objHelpers'
import { safeYamlDump } from '../utils/yamlUtils'

const TASK_MARKDOWN_REF_PREFIX = '_tref:'
const METADATA_REGEX = /<!--taskyon([\s\S]*?)-->/
const MARKDOWN_SEPARATOR_REGEX = /---(?=\s*<!--taskyon)/g
const MARKDOWN_TASK_REF_REGEX = /^[A-Za-z][A-Za-z0-9_-]*$/
const TASK_PLACEHOLDER_REGEX = /{{\s*(_t:[^{}]+?)\s*}}/g
const MARKDOWN_TASK_PLACEHOLDER_REGEX = /{{\s*(_tref:[^{}]+?)\s*}}/g

type MarkdownImportTaskRef = `${typeof TASK_MARKDOWN_REF_PREFIX}${string}`
type MarkdownTaskDraft = z.infer<typeof MarkdownTaskDraftSchema>

const MarkdownTaskDraftSchema = partialTaskDraft.extend({
  taskRef: z.string().regex(MARKDOWN_TASK_REF_REGEX).optional(),
})

const isMarkdownImportTaskRef = (value: string): value is MarkdownImportTaskRef =>
  value.startsWith(TASK_MARKDOWN_REF_PREFIX) && value.length > TASK_MARKDOWN_REF_PREFIX.length

const markdownTaskRefToAlias = (value: MarkdownImportTaskRef) =>
  value.slice(TASK_MARKDOWN_REF_PREFIX.length)

const toMarkdownTaskRef = (alias: string): MarkdownImportTaskRef =>
  `${TASK_MARKDOWN_REF_PREFIX}${alias}`

const toTaskRef = (taskId: string) => `${TASK_REF_PREFIX}${taskId}`

const sanitizeTaskRef = (value: string) => {
  const normalized = value
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9_-]/g, '')
    .replace(/^[^A-Za-z]+/, '')
  return normalized || 'task'
}

const makeUniqueTaskRef = (base: string, used: Set<string>) => {
  let candidate = base
  let counter = 2
  while (used.has(candidate)) {
    candidate = `${base}_${counter}`
    counter += 1
  }
  used.add(candidate)
  return candidate
}

const parseMarkdownMetadata = (rawMetadata: string | undefined) => {
  if (!rawMetadata) return { role: 'user' }
  return (load(rawMetadata.trim()) ?? {}) as Record<string, unknown>
}

const parseMarkdownTaskDrafts = (markdown: string): MarkdownTaskDraft[] => {
  const messages = markdown.split(MARKDOWN_SEPARATOR_REGEX).map((message) => message.trim())

  return messages.map((message) => {
    const metadataMatch = METADATA_REGEX.exec(message)
    const metadata = parseMarkdownMetadata(metadataMatch?.[1])
    const content = message.replace(METADATA_REGEX, '').trim()
    const taskDraft = {
      content: { type: 'message', data: content },
      ...metadata,
    }
    const parsed = MarkdownTaskDraftSchema.safeParse(taskDraft)
    if (!parsed.success) {
      throw new Error(
        `We were not able to convert markdown to a task node: \n\n${JSON.stringify(parsed.error)}`,
      )
    }
    return parsed.data
  })
}

const rewriteMarkdownTaskRefsInString = (value: string, aliasToTaskId: Map<string, string>) => {
  const directTaskRef = isMarkdownImportTaskRef(value) ? value : undefined
  if (directTaskRef) {
    const alias = markdownTaskRefToAlias(directTaskRef)
    const taskId = aliasToTaskId.get(alias)
    if (!taskId) {
      throw new Error(`Unknown markdown task reference: ${directTaskRef}`)
    }
    return toTaskRef(taskId)
  }

  return value.replace(MARKDOWN_TASK_PLACEHOLDER_REGEX, (_match, rawRef: string) => {
    if (!isMarkdownImportTaskRef(rawRef)) return _match
    const alias = markdownTaskRefToAlias(rawRef)
    const taskId = aliasToTaskId.get(alias)
    if (!taskId) {
      throw new Error(`Unknown markdown task reference: ${rawRef}`)
    }
    return `{{${toTaskRef(taskId)}}}`
  })
}

const rewriteMarkdownTaskRefs = (value: unknown, aliasToTaskId: Map<string, string>): unknown => {
  if (typeof value === 'string') {
    return rewriteMarkdownTaskRefsInString(value, aliasToTaskId)
  }
  if (Array.isArray(value)) {
    return value.map((item) => rewriteMarkdownTaskRefs(item, aliasToTaskId))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        rewriteMarkdownTaskRefs(item, aliasToTaskId),
      ]),
    )
  }
  return value
}

const stripMarkdownTaskDraft = (task: MarkdownTaskDraft): partialTaskDraft => {
  const { taskRef, ...rest } = task
  void taskRef
  return partialTaskDraft.parse(rest)
}

const collectTaskRefsFromString = (value: string): string[] => {
  const directTaskRef = value.startsWith(TASK_REF_PREFIX)
    ? value.slice(TASK_REF_PREFIX.length)
    : undefined
  const placeholderRefs = Array.from(value.matchAll(TASK_PLACEHOLDER_REGEX)).flatMap((match) => {
    const rawRef = match[1]
    return rawRef?.startsWith(TASK_REF_PREFIX) ? [rawRef.slice(TASK_REF_PREFIX.length)] : []
  })
  return directTaskRef ? [directTaskRef, ...placeholderRefs] : placeholderRefs
}

const collectTaskRefs = (value: unknown): string[] => {
  if (typeof value === 'string') return collectTaskRefsFromString(value)
  if (Array.isArray(value)) return value.flatMap(collectTaskRefs)
  if (value && typeof value === 'object') return Object.values(value).flatMap(collectTaskRefs)
  return []
}

const rewriteTaskRefsForMarkdownExport = (
  value: unknown,
  taskIdToAlias: Map<string, string>,
): unknown => {
  if (typeof value === 'string') {
    const directTaskRef = value.startsWith(TASK_REF_PREFIX)
      ? value.slice(TASK_REF_PREFIX.length)
      : undefined
    if (directTaskRef) {
      const alias = taskIdToAlias.get(directTaskRef)
      return alias ? toMarkdownTaskRef(alias) : value
    }
    return value.replace(TASK_PLACEHOLDER_REGEX, (_match, rawRef: string) => {
      if (!rawRef.startsWith(TASK_REF_PREFIX)) return _match
      const taskId = rawRef.slice(TASK_REF_PREFIX.length)
      const alias = taskIdToAlias.get(taskId)
      return alias ? `{{${toMarkdownTaskRef(alias)}}}` : _match
    })
  }
  if (Array.isArray(value)) {
    return value.map((item) => rewriteTaskRefsForMarkdownExport(item, taskIdToAlias))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        rewriteTaskRefsForMarkdownExport(item, taskIdToAlias),
      ]),
    )
  }
  return value
}

const createPortableTaskRefMap = (taskList: TaskNode[]) => {
  const referencedTaskIds = new Set(taskList.flatMap((task) => collectTaskRefs(task.content.data)))
  const tasksById = new Map(taskList.map((task) => [task.id, task]))
  const variableService = createTaskVariablePresentationService()
  const usedAliases = new Set<string>()
  const taskIdToAlias = new Map<string, string>()

  for (const taskId of referencedTaskIds) {
    const task = tasksById.get(taskId)
    if (!task) continue
    const preferredAlias =
      task.name && MARKDOWN_TASK_REF_REGEX.test(sanitizeTaskRef(task.name))
        ? sanitizeTaskRef(task.name)
        : variableService.getOrAssignVariableName(task, tasksById)
    taskIdToAlias.set(taskId, makeUniqueTaskRef(preferredAlias, usedAliases))
  }

  return taskIdToAlias
}

const renderTaskAsMarkdown = (
  task: TaskNode,
  taskIdToAlias: Map<string, string>,
  fullMeta: boolean,
) => {
  const rewrittenTask = rewriteTaskRefsForMarkdownExport(task, taskIdToAlias) as TaskNode
  const message =
    rewrittenTask.content.type === 'message'
      ? '\n\n' + String(rewriteTaskRefsForMarkdownExport(rewrittenTask.content.data, taskIdToAlias))
      : ''

  const partialTask = deepCopy(rewrittenTask) as Record<string, unknown>
  const alias = taskIdToAlias.get(task.id)
  if (alias) partialTask.taskRef = alias

  if (!fullMeta && partialTask) {
    delete partialTask.result
    delete partialTask.id
    delete partialTask.created_at
    delete partialTask.priorID
    if (message) delete partialTask.content
  }

  const yamlMeta = `<!--taskyon\n${safeYamlDump(partialTask)}\n-->`
  return yamlMeta + message
}

export async function getTextFile(url: URL | string) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch text file: ${response.statusText}`)
  }
  return response.text()
}

export const fetchMarkdown = async (folder: string, filePath: string) => {
  const fileURL = folder ? `/${folder}/${filePath}` : `/${filePath}`
  const response = await fetch(fileURL)
  const contentType = response.headers.get('Content-Type') || ''
  if (!response.ok || contentType.includes('text/html')) {
    throw new Error(`Failed to load markdown file: ${fileURL}`)
  }
  return response.text()
}

export const processMarkdown = (markdown: string) =>
  parseMarkdownTaskDrafts(markdown).map((task) => stripMarkdownTaskDraft(task))

export const addMarkdownTaskChain = async (
  markdown: string,
  addTask: (task: partialTaskDraft) => Promise<TaskNode>,
) => {
  const taskDrafts = parseMarkdownTaskDrafts(markdown)
  const seenAliases = new Set<string>()
  const aliasToTaskId = new Map<string, string>()
  const addedTasks: TaskNode[] = []

  for (const taskDraft of taskDrafts) {
    if (taskDraft.taskRef) {
      if (seenAliases.has(taskDraft.taskRef)) {
        throw new Error(`Duplicate markdown taskRef: ${taskDraft.taskRef}`)
      }
      seenAliases.add(taskDraft.taskRef)
    }

    const rewrittenDraft = rewriteMarkdownTaskRefs(taskDraft, aliasToTaskId)
    const addedTask = await addTask(
      stripMarkdownTaskDraft(MarkdownTaskDraftSchema.parse(rewrittenDraft)),
    )
    if (taskDraft.taskRef) aliasToTaskId.set(taskDraft.taskRef, addedTask.id)
    addedTasks.push(addedTask)
  }

  return addedTasks
}

export const createMarkdownTaskChain = async (markdown?: string): Promise<TaskNode[]> => {
  if (!markdown) return []
  let lastTaskId: string | undefined
  return await addMarkdownTaskChain(markdown, async (task) => {
    const taskNode = await createTaskNode({ ...task, priorID: lastTaskId })
    lastTaskId = taskNode.id
    return taskNode
  })
}

export const chatToYaml = (taskList: TaskNode[]) =>
  safeYamlDump({
    version: 1,
    contents: Object.fromEntries(
      taskList.map((task) => [taskNodeToRecord(task).contentRef, task.content]),
    ),
    tasks: taskList.map(taskNodeToRecord),
  })

export const task2Md = (task: TaskNode, fullMeta = false) => {
  const taskIdToAlias = createPortableTaskRefMap([task])
  return renderTaskAsMarkdown(task, taskIdToAlias, fullMeta)
}

export function chat2Md(taskList: TaskNode[], fullMeta = false) {
  const taskIdToAlias = createPortableTaskRefMap(taskList)
  const messageStrings = taskList.map((task) => renderTaskAsMarkdown(task, taskIdToAlias, fullMeta))

  return messageStrings.join('\n\n---\n\n')
}
