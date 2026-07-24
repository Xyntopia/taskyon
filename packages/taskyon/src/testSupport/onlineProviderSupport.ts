import type { DiagnosticsTestContext } from '@taskyon/common/modules/diagnosticsRunner'
import { createTaskNode } from '../core/createTasks'
import { chatCompletionProviderSettings } from '../types/chatCompletion'
import { llmSettings } from '../types/profiles'
import type { partialTaskDraft, TaskNode } from '../types/taskNode'

const resolveSelectedApi = () => process.env.TASKYON_SELECTED_API?.trim()

export const resolveApiKey = () =>
  (resolveSelectedApi() === 'chatgpt-codex'
    ? process.env.TASKYON_CHATGPT_CODEX_API_KEY?.trim() || process.env.CHATGPT_CODEX_API_KEY?.trim()
    : undefined) ||
  (resolveSelectedApi() === 'openrouter.ai'
    ? process.env.TASKYON_OPENROUTER_API_KEY?.trim() || process.env.OPENROUTER_API_KEY?.trim()
    : undefined) ||
  (resolveSelectedApi() === 'taskyon' ? process.env.TASKYON_API_KEY?.trim() : undefined) ||
  process.env.TASKYON_API_KEY?.trim() ||
  process.env.OPENAI_API_KEY?.trim() ||
  process.env.OPENROUTER_API_KEY?.trim() ||
  ''

export const resolveDiagnosticsRuntimeConfig = (context: DiagnosticsTestContext | undefined) => {
  const settings = llmSettings.safeParse(context?.llmSettings)
  const toolchainConfig =
    context?.toolchainConfig &&
    typeof context.toolchainConfig === 'object' &&
    !Array.isArray(context.toolchainConfig)
      ? context.toolchainConfig
      : undefined
  const providerSettings = chatCompletionProviderSettings.safeParse(
    toolchainConfig && 'chatCompletion' in toolchainConfig
      ? toolchainConfig.chatCompletion
      : undefined,
  )
  if (!settings.success || !providerSettings.success) return undefined
  return {
    settings: settings.data,
    providerSettings: providerSettings.data,
  }
}

export const resolveOnlineModel = () => {
  const selectedApi = resolveSelectedApi()
  return (
    process.env.TASKYON_TEST_MODEL?.trim() ||
    process.env.TASKYON_MODEL?.trim() ||
    (selectedApi === 'chatgpt-codex' ? 'gpt-5.4' : 'gpt-4o-mini')
  )
}

export const buildLinkedTaskChain = async (
  tasks: partialTaskDraft[],
): Promise<[TaskNode, ...TaskNode[]]> => {
  const linked: TaskNode[] = []
  let priorID: string | undefined

  for (const task of tasks) {
    const createdTask = await createTaskNode({ ...task, priorID }, { createMeta: 'missing' })
    linked.push(createdTask)
    priorID = createdTask.id
  }

  if (linked.length === 0) {
    throw new Error('Expected at least one task when building a linked test chain')
  }

  return linked as [TaskNode, ...TaskNode[]]
}
