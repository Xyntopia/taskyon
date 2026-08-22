import { load } from 'js-yaml'
import z from 'zod'
import { createTaskNode, taskContentHash, taskNodeToRecord } from './createTasks'
import { createTaskVariablePresentationService, TASK_REF_PREFIX } from './taskVariables'
import type { TaskContent as TaskContentValue, TaskNode as TaskNodeValue } from '../types/taskNode'
import {
  TaskContent,
  TaskContentRecord,
  TaskNode,
  TaskNodeRecord,
  partialTaskDraft,
} from '../types/taskNode'
import { deepCopy } from '../utils/objHelpers'
import { safeYamlDump } from '../utils/yamlUtils'

const TASK_MARKDOWN_REF_PREFIX = '_tref:'
const METADATA_REGEX = /<!--taskyon([\s\S]*?)-->/
const DOCUMENT_METADATA_REGEX = /<!--taskyon-document([\s\S]*?)-->/g
const MARKDOWN_SEPARATOR_REGEX = /---(?=\s*<!--taskyon)/g
const MARKDOWN_TASK_REF_REGEX = /^[A-Za-z][A-Za-z0-9_-]*$/
const TASK_PLACEHOLDER_REGEX = /{{\s*(_t:[^{}]+?)\s*}}/g
const MARKDOWN_TASK_PLACEHOLDER_REGEX = /{{\s*(_tref:[^{}]+?)\s*}}/g

export type TaskDocumentFormat = 'markdown' | 'yaml'

export type TaskDocument = {
  format: TaskDocumentFormat
  tasks: TaskNodeValue[]
  leafID?: string
  legacy?: boolean
}

type MarkdownImportTaskRef = `${typeof TASK_MARKDOWN_REF_PREFIX}${string}`
type MarkdownTaskDraft = z.infer<typeof MarkdownTaskDraftSchema>

const MarkdownTaskDraftSchema = TaskNode.partial()
  .required({ role: true })
  .extend({
    taskRef: z.string().regex(MARKDOWN_TASK_REF_REGEX).optional(),
    contentAlias: z.string().regex(MARKDOWN_TASK_REF_REGEX).optional(),
    content: TaskContent.optional(),
  })

const TaskArchiveSchema = z.object({
  version: z.literal(1),
  leafID: z.string().optional(),
  contents: z.record(z.string(), TaskContentRecord.shape.content),
  tasks: z.array(TaskNodeRecord),
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
  if (!rawMetadata) return { role: 'user' as const }
  return (load(rawMetadata.trim()) ?? {}) as Record<string, unknown>
}

const parseMarkdownDocumentMetadata = (markdown: string) => {
  const matches = Array.from(markdown.matchAll(DOCUMENT_METADATA_REGEX))
  if (matches.length === 0) return { markdown, leafID: undefined }
  const metadata = matches.map((match) =>
    z
      .object({ version: z.literal(1), leafID: z.string().optional() })
      .parse(load(match[1]?.trim() ?? '{}')),
  )
  const latest = metadata.at(-1)
  return {
    markdown: markdown.replace(DOCUMENT_METADATA_REGEX, '').trim(),
    leafID: latest?.leafID,
  }
}

const parseMarkdownTaskDrafts = (markdown: string): MarkdownTaskDraft[] => {
  const document = parseMarkdownDocumentMetadata(markdown)
  if (!document.markdown) return []
  const messages = document.markdown
    .split(MARKDOWN_SEPARATOR_REGEX)
    .map((message) => message.trim())

  return messages.map((message) => {
    const metadataMatch = METADATA_REGEX.exec(message)
    const metadata = parseMarkdownMetadata(metadataMatch?.[1])
    const content = message.replace(METADATA_REGEX, '').trim()
    const taskDraft = {
      ...(content ? { content: { type: 'message', data: content } } : {}),
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
    if (!taskId) throw new Error(`Unknown markdown task reference: ${directTaskRef}`)
    return toTaskRef(taskId)
  }

  return value.replace(MARKDOWN_TASK_PLACEHOLDER_REGEX, (_match, rawRef: string) => {
    if (!isMarkdownImportTaskRef(rawRef)) return _match
    const alias = markdownTaskRefToAlias(rawRef)
    const taskId = aliasToTaskId.get(alias)
    if (!taskId) throw new Error(`Unknown markdown task reference: ${rawRef}`)
    return `{{${toTaskRef(taskId)}}}`
  })
}

const rewriteMarkdownTaskRefs = (value: unknown, aliasToTaskId: Map<string, string>): unknown => {
  if (typeof value === 'string') return rewriteMarkdownTaskRefsInString(value, aliasToTaskId)
  if (Array.isArray(value)) return value.map((item) => rewriteMarkdownTaskRefs(item, aliasToTaskId))
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
  const { taskRef, contentAlias, ...rest } = task
  void taskRef
  void contentAlias
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

const createPortableTaskRefMap = (
  taskList: readonly TaskNodeValue[],
  additionalTaskIds: readonly string[] = [],
) => {
  const referencedTaskIds = new Set([
    ...additionalTaskIds,
    ...taskList.flatMap((task) => collectTaskRefs(task.content.data)),
  ])
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

const createContentAliasMap = (taskList: readonly TaskNodeValue[]) => {
  const usedAliases = new Set<string>()
  const firstTaskByContentHash = new Map<string, TaskNodeValue>()
  const aliasByContentHash = new Map<string, string>()
  const aliasByTaskId = new Map<string, { alias: string; repeated: boolean }>()

  for (const task of taskList) {
    if (task.content.type !== 'functioncall') continue
    const contentHash = taskContentHash(task.content)
    const firstTask = firstTaskByContentHash.get(contentHash)
    if (firstTask) {
      const alias = aliasByContentHash.get(contentHash)
      if (alias) aliasByTaskId.set(task.id, { alias, repeated: true })
      continue
    }
    const alias = makeUniqueTaskRef(`${sanitizeTaskRef(task.content.data.name)}_call`, usedAliases)
    firstTaskByContentHash.set(contentHash, task)
    aliasByContentHash.set(contentHash, alias)
    aliasByTaskId.set(task.id, { alias, repeated: false })
  }

  return aliasByTaskId
}

const renderTaskAsMarkdown = (
  task: TaskNodeValue,
  taskIdToAlias: Map<string, string>,
  fullMeta: boolean,
  contentAlias?: { alias: string; repeated: boolean },
) => {
  const rewrittenTask = rewriteTaskRefsForMarkdownExport(task, taskIdToAlias) as TaskNodeValue
  const message =
    rewrittenTask.content.type === 'message'
      ? '\n\n' + String(rewriteTaskRefsForMarkdownExport(rewrittenTask.content.data, taskIdToAlias))
      : ''

  const partialTask = deepCopy(rewrittenTask) as Record<string, unknown>
  const alias = taskIdToAlias.get(task.id)
  if (alias) partialTask.taskRef = alias
  if (contentAlias) {
    partialTask.contentAlias = contentAlias.alias
    if (contentAlias.repeated) delete partialTask.content
  }

  if (!fullMeta) {
    delete partialTask.result
    delete partialTask.id
    delete partialTask.created_at
    delete partialTask.priorID
    delete partialTask.parentID
    if (message) delete partialTask.content
  }

  const yamlMeta = `<!--taskyon\n${safeYamlDump(partialTask)}\n-->`
  return yamlMeta + message
}

export const renderMarkdownDocumentMetadata = (leafID: string | undefined) => {
  if (!leafID) return ''
  return `<!--taskyon-document\n${safeYamlDump({ version: 1, leafID })}\n-->\n\n`
}

export const createMarkdownChatRenderer = (options?: {
  compactRepeatedToolCalls?: boolean
  leafID?: string
}) => {
  let previousTasks: TaskNodeValue[] = []

  const reset = () => {
    previousTasks = []
  }

  const render = (taskList: TaskNodeValue[], fullMeta = false) => {
    const allTasks = [...previousTasks, ...taskList]
    const taskIdToAlias = createPortableTaskRefMap(allTasks)
    const contentAliases = createContentAliasMap(allTasks)
    const useContentAliases = options?.compactRepeatedToolCalls !== false
    const messageStrings = taskList.map((task) =>
      renderTaskAsMarkdown(
        task,
        taskIdToAlias,
        fullMeta,
        useContentAliases ? contentAliases.get(task.id) : undefined,
      ),
    )
    previousTasks = allTasks
    return renderMarkdownDocumentMetadata(options?.leafID) + messageStrings.join('\n\n---\n\n')
  }

  return { render, reset }
}

export async function getTextFile(url: URL | string) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to fetch text file: ${response.statusText}`)
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

const rewriteMarkdownTaskDraft = (
  task: MarkdownTaskDraft,
  aliasToTaskId: Map<string, string>,
  content: TaskContentValue,
) => {
  const { taskRef, contentAlias, ...draft } = task
  void taskRef
  void contentAlias
  return partialTaskDraft.parse(rewriteMarkdownTaskRefs({ ...draft, content }, aliasToTaskId))
}

const parseMarkdownArchive = async (markdown: string): Promise<TaskDocument | undefined> => {
  const drafts = parseMarkdownTaskDrafts(markdown)
  if (drafts.length === 0 || drafts.some((draft) => !draft.id)) return undefined

  const document = parseMarkdownDocumentMetadata(markdown)
  const aliasToTaskId = new Map<string, string>()
  const contentAliasToContent = new Map<string, TaskContentValue>()
  const taskIDs = new Set<string>()

  for (const draft of drafts) {
    if (!draft.id || taskIDs.has(draft.id)) {
      throw new Error(`Duplicate markdown task id: ${draft.id}`)
    }
    taskIDs.add(draft.id)
    if (draft.taskRef) {
      if (aliasToTaskId.has(draft.taskRef)) {
        throw new Error(`Duplicate markdown taskRef: ${draft.taskRef}`)
      }
      aliasToTaskId.set(draft.taskRef, draft.id)
    }
    if (draft.contentAlias && draft.content) {
      const existing = contentAliasToContent.get(draft.contentAlias)
      if (existing && taskContentHash(existing) !== taskContentHash(draft.content)) {
        throw new Error(`Markdown contentAlias '${draft.contentAlias}' has conflicting content.`)
      }
      contentAliasToContent.set(draft.contentAlias, draft.content)
    }
  }

  const tasks = await Promise.all(
    drafts.map(async (draft) => {
      const content =
        draft.content ??
        (draft.contentAlias ? contentAliasToContent.get(draft.contentAlias) : undefined)
      if (!content) throw new Error(`Unknown markdown contentAlias: ${draft.contentAlias}`)
      return await createTaskNode(rewriteMarkdownTaskDraft(draft, aliasToTaskId, content), {
        createMeta: 'missing',
      })
    }),
  )

  if (document.leafID && !taskIDs.has(document.leafID)) {
    throw new Error(`Markdown document leafID is not present: ${document.leafID}`)
  }
  const leafID = document.leafID ?? tasks.at(-1)?.id
  return {
    format: 'markdown',
    tasks,
    ...(leafID ? { leafID } : {}),
  }
}

export const addMarkdownTaskChain = async (
  markdown: string,
  addTask: (task: partialTaskDraft) => Promise<TaskNodeValue>,
) => {
  const taskDrafts = parseMarkdownTaskDrafts(markdown)
  const seenTaskAliases = new Set<string>()
  const aliasToTaskId = new Map<string, string>()
  const contentAliasToContent = new Map<string, TaskContentValue>()
  const addedTasks: TaskNodeValue[] = []

  for (const taskDraft of taskDrafts) {
    if (taskDraft.taskRef) {
      if (seenTaskAliases.has(taskDraft.taskRef)) {
        throw new Error(`Duplicate markdown taskRef: ${taskDraft.taskRef}`)
      }
      seenTaskAliases.add(taskDraft.taskRef)
    }
    if (taskDraft.contentAlias && taskDraft.content) {
      contentAliasToContent.set(taskDraft.contentAlias, taskDraft.content)
    }
    const content =
      taskDraft.content ??
      (taskDraft.contentAlias ? contentAliasToContent.get(taskDraft.contentAlias) : undefined)
    if (!content) throw new Error(`Unknown markdown contentAlias: ${taskDraft.contentAlias}`)
    const rewrittenDraft = rewriteMarkdownTaskDraft(taskDraft, aliasToTaskId, content)
    const addedTask = await addTask(rewrittenDraft)
    if (taskDraft.taskRef) aliasToTaskId.set(taskDraft.taskRef, addedTask.id)
    addedTasks.push(addedTask)
  }

  return addedTasks
}

export const createMarkdownTaskDocument = async (markdown?: string): Promise<TaskDocument> => {
  if (!markdown) return { format: 'markdown', tasks: [] }
  const archive = await parseMarkdownArchive(markdown)
  if (archive) return archive

  let lastTaskId: string | undefined
  const tasks = await addMarkdownTaskChain(markdown, async (task) => {
    const taskNode = await createTaskNode({ ...task, priorID: task.priorID ?? lastTaskId })
    lastTaskId = taskNode.id
    return taskNode
  })
  const leafID = tasks.at(-1)?.id
  return { format: 'markdown', tasks, ...(leafID ? { leafID } : {}), legacy: true }
}

export const createMarkdownTaskChain = async (markdown?: string): Promise<TaskNodeValue[]> =>
  (await createMarkdownTaskDocument(markdown)).tasks

export const parseYamlTaskDocument = (yaml: string): TaskDocument => {
  const archive = TaskArchiveSchema.parse(load(yaml))
  const tasks = archive.tasks.map((record) => {
    const content = archive.contents[record.contentRef]
    if (!content) throw new Error(`Task content not found in archive: ${record.contentRef}`)
    const { contentRef: _contentRef, ...task } = record
    void _contentRef
    return TaskNode.parse({ ...task, content })
  })
  if (archive.leafID && !new Set(tasks.map((task) => task.id)).has(archive.leafID)) {
    throw new Error(`YAML document leafID is not present: ${archive.leafID}`)
  }
  const leafID = archive.leafID ?? tasks.at(-1)?.id
  return { format: 'yaml', tasks, ...(leafID ? { leafID } : {}) }
}

export const createTaskDocument = async (input: string, format?: TaskDocumentFormat) => {
  const detectedFormat =
    format ?? (/^\s*version:\s*1\b[\s\S]*^\s*tasks:/m.test(input) ? 'yaml' : 'markdown')
  return detectedFormat === 'yaml'
    ? parseYamlTaskDocument(input)
    : await createMarkdownTaskDocument(input)
}

export const chatToYaml = (taskList: readonly TaskNodeValue[], options?: { leafID?: string }) =>
  safeYamlDump({
    version: 1,
    ...(options?.leafID ? { leafID: options.leafID } : {}),
    contents: Object.fromEntries(
      taskList.map((task) => [taskNodeToRecord(task).contentRef, task.content]),
    ),
    tasks: taskList.map(taskNodeToRecord),
  })

export const task2Md = (task: TaskNodeValue, fullMeta = false) => {
  const taskIdToAlias = createPortableTaskRefMap([task])
  return renderTaskAsMarkdown(task, taskIdToAlias, fullMeta)
}

export function chat2Md(
  taskList: readonly TaskNodeValue[],
  fullMeta = false,
  options?: { compactRepeatedToolCalls?: boolean; leafID?: string },
) {
  return createMarkdownChatRenderer(options).render([...taskList], fullMeta)
}

export const processMarkdown = (markdown: string) =>
  parseMarkdownTaskDrafts(markdown).map((task) => {
    if (!task.content) return task
    return stripMarkdownTaskDraft(task)
  })
