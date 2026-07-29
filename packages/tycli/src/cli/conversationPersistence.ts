import { chat2Md, type Taskyon } from '@taskyon/taskyon'
import { createStorageClient, createTaskyonClient } from '@taskyon/taskyon/api'
import { resolveCliBlobStoragePath } from './fileStorage'

export const TYCLI_CONVERSATION_TRANSCRIPT_NAMESPACE = 'tycli/conversations'

export type ConversationPersistence = {
  filePath: string
  transcriptId: string
  persist: (leafId: string | undefined) => Promise<void>
  hasPersistedConversation: () => boolean
}

export const createConversationPersistQueue = (
  persist: (leafId: string) => Promise<void>,
  onError: (error: unknown) => void = () => undefined,
) => {
  let latestLeafId: string | undefined
  let requestedVersion = 0
  let persistedVersion = 0
  let activeDrain: Promise<void> | undefined

  const drain = async () => {
    while (persistedVersion < requestedVersion) {
      const version = requestedVersion
      const leafId = latestLeafId
      if (leafId) {
        try {
          await persist(leafId)
        } catch (error) {
          onError(error)
        }
      }
      persistedVersion = version
    }
  }

  const startDrain = () => {
    activeDrain ??= drain().finally(() => {
      activeDrain = undefined
      if (persistedVersion < requestedVersion) startDrain()
    })
  }

  return {
    request: (leafId: string | undefined) => {
      if (!leafId) return
      latestLeafId = leafId
      requestedVersion += 1
      startDrain()
    },
    flush: async () => {
      while (activeDrain) await activeDrain
    },
  }
}

const pad2 = (n: number) => String(n).padStart(2, '0')

const createSessionFileName = (startedAt: Date) => {
  const y = startedAt.getUTCFullYear()
  const m = pad2(startedAt.getUTCMonth() + 1)
  const d = pad2(startedAt.getUTCDate())
  const h = pad2(startedAt.getUTCHours())
  const min = pad2(startedAt.getUTCMinutes())
  const s = pad2(startedAt.getUTCSeconds())
  return `conversation-${y}${m}${d}-${h}${min}${s}-${process.pid}.md`
}

export const createConversationPersistence = async (args: {
  taskyon: Taskyon
  storageRoot: string
  storageClient: ReturnType<typeof createStorageClient>
  startedAt?: Date
}): Promise<ConversationPersistence> => {
  const startedAt = args.startedAt ?? new Date()
  const transcriptId = createSessionFileName(startedAt)
  const filePath = resolveCliBlobStoragePath(
    args.storageRoot,
    TYCLI_CONVERSATION_TRANSCRIPT_NAMESPACE,
    transcriptId,
  )
  let hasPersistedConversation = false
  let persistedTaskIds: string[] = []
  let persistedTaskSnapshots: string[] = []
  let persistedSize = 0

  const encodeMarkdown = (markdown: string) =>
    new TextEncoder().encode(markdown) as Uint8Array<ArrayBuffer>

  const persist = async (leafId: string | undefined) => {
    if (!leafId) return
    const chain = await createTaskyonClient(args.taskyon.port).task.getChain({ id: leafId })
    if (chain.length === 0) return

    const chainIds = chain.map((task) => task.id)
    const chainSnapshots = chain.map((task) => JSON.stringify(task))
    const extendsPersistedChain = persistedTaskIds.every(
      (id, index) =>
        chainIds[index] === id && persistedTaskSnapshots[index] === chainSnapshots[index],
    )
    if (!hasPersistedConversation || !extendsPersistedChain) {
      const data = encodeMarkdown(`${chat2Md(chain, false)}\n`)
      await args.storageClient.setBlob({
        namespace: TYCLI_CONVERSATION_TRANSCRIPT_NAMESPACE,
        id: transcriptId,
        data,
        contentType: 'text/markdown',
      })
      persistedSize = data.byteLength
    } else {
      const suffix = chain.slice(persistedTaskIds.length)
      if (suffix.length === 0) return
      const data = encodeMarkdown(`\n---\n\n${chat2Md(suffix, false)}\n`)
      const metadata = await args.storageClient.appendBlob({
        namespace: TYCLI_CONVERSATION_TRANSCRIPT_NAMESPACE,
        id: transcriptId,
        data,
        expectedSize: persistedSize,
        contentType: 'text/markdown',
      })
      persistedSize = metadata.size
    }
    persistedTaskIds = chainIds
    persistedTaskSnapshots = chainSnapshots
    hasPersistedConversation = true
  }

  return {
    filePath,
    transcriptId,
    persist,
    hasPersistedConversation: () => hasPersistedConversation,
  }
}
