import {
  chatToYaml,
  createMarkdownChatRenderer,
  renderMarkdownDocumentMetadata,
  type TaskNode,
  type TaskDocumentFormat,
} from '@taskyon/taskyon'
import { type createStorageClient } from '@taskyon/taskyon/api'
import { resolveCliBlobStoragePath } from './fileStorage'

export const TYCLI_CONVERSATION_TRANSCRIPT_NAMESPACE = 'tycli/conversations'

export type ConversationFormat = TaskDocumentFormat

export type ConversationPersistence = {
  filePath: string
  transcriptId: string
  persist: (task: TaskNode) => Promise<void>
  flush: (warnUnresolved?: boolean) => Promise<void>
  hasPersistedConversation: () => boolean
}

export const createConversationPersistQueue = (
  persist: (task: TaskNode) => Promise<void>,
  onError: (error: unknown) => void = () => undefined,
) => {
  const pendingTasks = new Map<string, TaskNode>()
  let activeDrain: Promise<void> | undefined

  const drain = async () => {
    while (pendingTasks.size > 0) {
      const tasks = [...pendingTasks.values()]
      pendingTasks.clear()
      for (const task of tasks) {
        try {
          await persist(task)
        } catch (error) {
          onError(error)
        }
      }
    }
  }

  const startDrain = () => {
    activeDrain ??= drain().finally(() => {
      activeDrain = undefined
      if (pendingTasks.size > 0) startDrain()
    })
  }

  return {
    request: (task: TaskNode | undefined) => {
      if (!task) return
      pendingTasks.set(task.id, task)
      startDrain()
    },
    flush: async () => {
      while (activeDrain) await activeDrain
    },
  }
}

const pad2 = (n: number) => String(n).padStart(2, '0')

const createSessionFileName = (startedAt: Date, format: ConversationFormat) => {
  const y = startedAt.getUTCFullYear()
  const m = pad2(startedAt.getUTCMonth() + 1)
  const d = pad2(startedAt.getUTCDate())
  const h = pad2(startedAt.getUTCHours())
  const min = pad2(startedAt.getUTCMinutes())
  const s = pad2(startedAt.getUTCSeconds())
  return `conversation-${y}${m}${d}-${h}${min}${s}-${process.pid}.${format === 'yaml' ? 'yaml' : 'md'}`
}

export const createConversationPersistence = (args: {
  storageRoot?: string
  storageNamespace?: string
  storageClient: ReturnType<typeof createStorageClient>
  startedAt?: Date
  format?: ConversationFormat
}): Promise<ConversationPersistence> => {
  const startedAt = args.startedAt ?? new Date()
  const format = args.format ?? 'markdown'
  const transcriptId = createSessionFileName(startedAt, format)
  const storedNamespace = args.storageNamespace
    ? `${args.storageNamespace}/${TYCLI_CONVERSATION_TRANSCRIPT_NAMESPACE}`
    : TYCLI_CONVERSATION_TRANSCRIPT_NAMESPACE
  const filePath = args.storageRoot
    ? resolveCliBlobStoragePath(args.storageRoot, storedNamespace, transcriptId)
    : `storage://${storedNamespace}/${transcriptId}`
  let hasPersistedConversation = false
  let persistedDocument = ''
  let persistedMarkdownSize = 0
  let hasPersistedMarkdownTask = false
  let persistedMarkdownLeafID: string | undefined
  const markdownRenderer = createMarkdownChatRenderer({ compactRepeatedToolCalls: true })
  const markdownPendingTasks = new Map<string, TaskNode>()
  const markdownWrittenTasks: TaskNode[] = []
  const markdownWrittenTaskSnapshots = new Map<string, string>()
  const yamlTasks = new Map<string, TaskNode>()
  const yamlTaskOrder: string[] = []

  const taskSnapshot = (task: TaskNode) => JSON.stringify(task)
  const sortTasks = (tasks: TaskNode[]) =>
    tasks.sort((left, right) => {
      const createdDifference = (left.created_at ?? 0) - (right.created_at ?? 0)
      return createdDifference || left.id.localeCompare(right.id)
    })

  const appendMarkdownState = async (leafID: string) => {
    if (persistedMarkdownLeafID === leafID && hasPersistedMarkdownTask) return
    const state = `\n\n${renderMarkdownDocumentMetadata(leafID)}`
    const metadata = await args.storageClient.appendBlob({
      namespace: TYCLI_CONVERSATION_TRANSCRIPT_NAMESPACE,
      id: transcriptId,
      data: new TextEncoder().encode(state),
      expectedSize: persistedMarkdownSize,
      contentType: 'text/markdown',
    })
    persistedMarkdownSize = metadata.size
    persistedMarkdownLeafID = leafID
    hasPersistedConversation = true
  }

  const appendMarkdownTask = async (task: TaskNode, leafID: string) => {
    const snapshot = taskSnapshot(task)
    const writtenSnapshot = markdownWrittenTaskSnapshots.get(task.id)
    if (writtenSnapshot) {
      if (writtenSnapshot !== snapshot) {
        throw new Error(`Immutable task ${task.id} changed after Markdown persistence.`)
      }
      await appendMarkdownState(leafID)
      return
    }

    const renderedTask = markdownRenderer.render([task], true)
    const separator = hasPersistedMarkdownTask ? '\n\n---\n\n' : ''
    let metadata: Awaited<ReturnType<typeof args.storageClient.appendBlob>>
    try {
      metadata = await args.storageClient.appendBlob({
        namespace: TYCLI_CONVERSATION_TRANSCRIPT_NAMESPACE,
        id: transcriptId,
        data: new TextEncoder().encode(`${separator}${renderedTask}`),
        expectedSize: persistedMarkdownSize,
        contentType: 'text/markdown',
      })
    } catch (error) {
      markdownRenderer.reset()
      for (const writtenTask of markdownWrittenTasks) {
        markdownRenderer.render([writtenTask], true)
      }
      throw error
    }
    persistedMarkdownSize = metadata.size
    hasPersistedMarkdownTask = true
    hasPersistedConversation = true
    markdownWrittenTaskSnapshots.set(task.id, snapshot)
    markdownWrittenTasks.push(task)
    await appendMarkdownState(leafID)
  }

  const drainMarkdownPending = async (leafID: string) => {
    while (true) {
      const readyTasks = sortTasks(
        [...markdownPendingTasks.values()].filter((task) =>
          [task.parentID, task.priorID]
            .filter((id): id is string => Boolean(id))
            .every((id) => markdownWrittenTaskSnapshots.has(id)),
        ),
      )
      if (readyTasks.length === 0) return
      for (const readyTask of readyTasks) {
        markdownPendingTasks.delete(readyTask.id)
        await appendMarkdownTask(readyTask, leafID)
      }
    }
  }

  const persist = async (task: TaskNode) => {
    if (format === 'markdown') {
      const pendingTask = markdownPendingTasks.get(task.id)
      if (pendingTask && taskSnapshot(pendingTask) !== taskSnapshot(task)) {
        throw new Error(`Immutable task ${task.id} changed before Markdown persistence.`)
      }
      markdownPendingTasks.set(task.id, task)
      await drainMarkdownPending(task.id)
      return
    }

    const snapshot = taskSnapshot(task)
    const existing = yamlTasks.get(task.id)
    if (existing && taskSnapshot(existing) !== snapshot) {
      throw new Error(`Immutable task ${task.id} changed during YAML persistence.`)
    }
    if (!existing) {
      yamlTasks.set(task.id, task)
      yamlTaskOrder.push(task.id)
    }
    const document = chatToYaml(yamlTaskOrder.map((id) => yamlTasks.get(id)!).filter(Boolean), {
      leafID: task.id,
    })
    if (document === persistedDocument) return
    await args.storageClient.setBlob({
      namespace: TYCLI_CONVERSATION_TRANSCRIPT_NAMESPACE,
      id: transcriptId,
      data: new TextEncoder().encode(document),
      contentType: 'text/yaml',
    })
    persistedDocument = document
    hasPersistedConversation = true
  }

  return Promise.resolve({
    filePath,
    transcriptId,
    persist,
    flush: (warnUnresolved = false) => {
      if (warnUnresolved && markdownPendingTasks.size > 0) {
        console.warn(
          `Conversation archive has ${markdownPendingTasks.size} task(s) with unresolved parent or prior links.`,
        )
      }
      return Promise.resolve()
    },
    hasPersistedConversation: () => hasPersistedConversation,
  })
}
