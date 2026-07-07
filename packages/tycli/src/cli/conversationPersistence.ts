import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { chat2Md, type Taskyon } from '@taskyon/taskyon'
import { createTaskyonClient } from '@taskyon/taskyon/api'

export type ConversationPersistence = {
  filePath: string
  persist: (leafId: string | undefined) => Promise<void>
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
  configDir: string
  startedAt?: Date
}): Promise<ConversationPersistence> => {
  const startedAt = args.startedAt ?? new Date()
  const conversationDir = join(args.configDir, 'conversations')
  await mkdir(conversationDir, { recursive: true })
  const filePath = join(conversationDir, createSessionFileName(startedAt))
  await writeFile(filePath, '# Taskyon Conversation\n\n', 'utf8')

  const persist = async (leafId: string | undefined) => {
    if (!leafId) return
    const chain = await createTaskyonClient(args.taskyon.port).task.getChain({ id: leafId })
    const markdown = chat2Md(chain, false)
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, `${markdown}\n`, 'utf8')
  }

  return { filePath, persist }
}
