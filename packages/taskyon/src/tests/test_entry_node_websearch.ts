import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { tyCore } from '../core/init'
import { createStandardEntryNodeTool } from '../tools/entryNode'
import {
  buildLinkedTaskChain,
  resolveApiConfig,
  resolveApiKey,
  resolveOnlineModel,
} from './onlineProviderSupport'
import { registerToolRpcTools } from '../core/toolRpc'
import { toolCall } from '../types/toolApi'
import type { TaskNode } from '../types/taskNode'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

const hasExecutedWebSearch = (streamContent: string) =>
  /response\.web_search_call\./i.test(streamContent) ||
  /web_search:\s*\n\s*num_requests:\s*[1-9]/i.test(streamContent)

const waitForTaskMeta = async (
  readMeta: (taskId: string) => Promise<unknown>,
  taskId: string,
  attempts = 20,
) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const meta = await readMeta(taskId)
    if (meta && typeof meta === 'object' && 'streamContent' in meta) return meta
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return await readMeta(taskId)
}

export const testEntryNodeWebsearchProducesHostedSearchUsage = async () => {
  const apiKey = resolveApiKey()
  if (!apiKey) {
    return {
      skipped: true,
      reason:
        'No provider credential found. Set TASKYON_SELECTED_API plus the matching provider key environment.',
    }
  }

  const model = resolveOnlineModel()
  const apiConfig = resolveApiConfig(apiKey, model)
  const dataDir = join(tmpdir(), `taskyon-websearch-test-${Date.now()}`)
  await mkdir(dataDir, { recursive: true })

  const entryNodeTool = createStandardEntryNodeTool({
    name: 'entryNode',
    renderOptions: { hideChat: true, hideLlm: true },
    defaultAllowedTools: [],
    toolChooser: { enabled: true, useTools: true },
  })

  const ty = await tyCore(
    () => ({
      selectedApi: apiConfig.selectedApi,
      llmApis: apiConfig.llmApis,
      siteUrl: 'https://taskyon.space',
      entryFunction: 'entryNode',
    }),
    () =>
      toolCall({
        name: 'entryNode',
        arguments: {},
      }),
    () => ({
      entryNode: {
        providerToolCalling: true,
      },
    }),
    undefined,
    { nodePgLiteDataDir: dataDir },
  )
  const toolRpcExecutor = await registerToolRpcTools({ port: ty.port, tools: [entryNodeTool] })

  await ty.setSecret('chatCompletionApiKeys', apiConfig.selectedApi, apiKey)
  await ty.updateChatCompletionApiKey(apiConfig.selectedApi, apiKey)

  const observed: TaskNode[] = []
  const finish = await new Promise<{ assistant: TaskNode; tasks: TaskNode[] }>(
    (resolve, reject) => {
      const timeout = setTimeout(() => {
        unsubscribe()
        reject(new Error('Timed out waiting for entry-node websearch flow'))
      }, 180_000)
      const unsubscribe = ty.port.receive((msg) => {
        if (msg.type !== 'taskCreated' || !msg.task) return
        const task = msg.task
        observed.push(task)
        if (task.role === 'assistant' && task.content.type === 'message') {
          const text = String(task.content.data ?? '')
          if (text.trim().length > 0) {
            clearTimeout(timeout)
            unsubscribe()
            resolve({ assistant: task, tasks: observed })
          }
        }
      })
      void buildLinkedTaskChain([
        {
          role: 'user',
          content: {
            type: 'message',
            data: 'What is one current AI headline today? Keep it to one short sentence.',
          },
        },
        toolCall({
          name: 'entryNode',
          arguments: {
            websearch: {
              enabled: true,
              max_results: 3,
            },
          },
        }),
      ])
        .then((tasks) =>
          ty.port.send({
            type: 'tasks',
            execute: true,
            show: false,
            tasks,
          }),
        )
        .catch(reject)
    },
  )

  const chatCompletionTask = finish.tasks.find(
    (task) => task.content.type === 'functioncall' && task.content.data.name === 'chatCompletion',
  )
  if (!chatCompletionTask) {
    throw new Error('Expected entryNode to create a chatCompletion task')
  }

  const meta = await waitForTaskMeta(ty.getMeta, chatCompletionTask.id)
  const streamContent =
    meta &&
    typeof meta === 'object' &&
    'streamContent' in meta &&
    typeof meta.streamContent === 'string'
      ? meta.streamContent
      : ''

  assert(streamContent.length > 0, 'Expected chatCompletion metadata to include stream content')
  assert(
    hasExecutedWebSearch(streamContent),
    'Expected hosted web search usage in the chatCompletion stream metadata',
  )

  toolRpcExecutor.destroy()

  return {
    success: true,
    model,
    selectedApi: apiConfig.selectedApi,
    assistantMessage:
      finish.assistant.content.type === 'message' ? finish.assistant.content.data : '',
  }
}

testEntryNodeWebsearchProducesHostedSearchUsage.description =
  'Runs entryNode with websearch enabled and verifies that the hosted provider actually performed web search.'
