import { createTaskNode } from '../core/createTasks'
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

export const resolveApiConfig = (apiKey: string, model: string) => {
  const selectedApi = resolveSelectedApi()
  if (selectedApi === 'taskyon' || process.env.TASKYON_API_KEY?.trim() === apiKey) {
    return {
      selectedApi: 'taskyon',
      llmApis: {
        taskyon: {
          name: 'taskyon',
          baseURL: 'https://share.taskyon.space/chatCompletion/api/v1',
          defaultModel: model,
          selectedModel: model,
          streamSupport: true,
          routes: {
            chatCompletion: '/chat/completions',
            models: '/models',
          },
        },
      },
    }
  }
  if (selectedApi === 'openrouter.ai') {
    return {
      selectedApi: 'openrouter.ai',
      llmApis: {
        'openrouter.ai': {
          name: 'openrouter.ai',
          baseURL: 'https://openrouter.ai/api/v1',
          defaultModel: model,
          selectedModel: model,
          streamSupport: true,
          routes: {
            chatCompletion: '/chat/completions',
            models: '/models',
          },
        },
      },
    }
  }
  if (selectedApi === 'chatgpt-codex') {
    const accountId = process.env.TASKYON_CHATGPT_CODEX_ACCOUNT_ID?.trim()
    return {
      selectedApi: 'chatgpt-codex',
      llmApis: {
        'chatgpt-codex': {
          name: 'chatgpt-codex',
          baseURL: 'https://chatgpt.com/backend-api/codex',
          defaultModel: model,
          selectedModel: model,
          streamSupport: true,
          ...(accountId ? { defaultHeaders: { 'ChatGPT-Account-Id': accountId } } : {}),
          routes: {
            chatCompletion: '/responses',
            models: '/models',
          },
        },
      },
    }
  }
  return {
    selectedApi: 'openai',
    llmApis: {
      openai: {
        name: 'openai',
        baseURL: 'https://api.openai.com/v1',
        defaultModel: model,
        selectedModel: model,
        streamSupport: true,
        routes: {
          chatCompletion: '/chat/completions',
          models: '/models',
        },
      },
    },
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
