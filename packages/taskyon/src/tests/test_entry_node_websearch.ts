import type { DiagnosticsTestContext } from '@taskyon/common/modules/diagnosticsRunner'
import { tyCore } from '../core/init'
import { createTaskyonClient } from '../api'
import { createStandardEntryNodeTool } from '../tools/entryNode'
import { createDefaultTaskyonToolSetup } from '../tools'
import {
  buildLinkedTaskChain,
  resolveDiagnosticsRuntimeConfig,
} from '../testSupport/onlineProviderSupport'
import { createExternalToolContext, registerToolRpcTools } from '../core/toolRpc'
import { toolCall } from '../types/toolApi'
import type { TaskNode } from '../types/taskNode'
import { createPortableTestStorage } from '../testSupport/portableTestStorage'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

const hasExecutedWebSearch = (streamContent: string) =>
  /response\.web_search_call\./i.test(streamContent) ||
  /web_search:\s*\n\s*num_requests:\s*[1-9]/i.test(streamContent)

const hasSearchSource = (tasks: TaskNode[]) =>
  tasks.some(
    (task) =>
      task.content.type === 'message' &&
      task.content.ann?.some((annotation) => annotation.type === 'url'),
  )

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

export const testEntryNodeWebsearchProducesHostedSearchUsage = async (
  context?: DiagnosticsTestContext,
) => {
  if (!context?.providerKey) {
    return {
      skipped: true,
      reason: 'No configured provider key/session was available from the diagnostics harness.',
    }
  }
  const runtimeConfig = resolveDiagnosticsRuntimeConfig(context)
  if (!runtimeConfig) {
    return {
      skipped: true,
      reason: 'No runtime llmSettings were provided by the diagnostics harness.',
    }
  }

  const storage = createPortableTestStorage()

  const entryNodeTool = createStandardEntryNodeTool({
    name: 'entryNode',
    renderOptions: { hideChat: true, hideLlm: true },
    defaultAllowedTools: [],
    toolChooser: { enabled: true, useTools: true, webSearch: true },
  })

  const ty = await tyCore(
    () => runtimeConfig.settings,
    () =>
      toolCall({
        name: 'entryNode',
        arguments: {},
      }),
    {
      chatCompletion: runtimeConfig.providerSettings,
      entryNode: {
        providerToolCalling: true,
      },
    },
    undefined,
    {
      toolSetup: createDefaultTaskyonToolSetup(),
      taskManagerStorageFactory: storage.taskManagerStorageFactory,
    },
  )
  const toolRpcExecutor = await registerToolRpcTools({
    port: ty.port,
    tools: [entryNodeTool],
    createContext: (call, stopSignal) =>
      createExternalToolContext(stopSignal, {
        getExecutionTaskChain: () => {
          if (!call.taskId) throw new Error('Expected task id for entryNode test')
          return createTaskyonClient(ty.port).task.getChain({ id: call.taskId })
        },
      }),
  })

  try {
    const selectedApi = runtimeConfig.providerSettings.provider
    const providerKey = context.providerKey
    await ty.updateChatCompletionApiKey(selectedApi, providerKey)

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
            createTaskyonClient(ty.port).task.createChain({
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
      hasExecutedWebSearch(streamContent) || hasSearchSource(finish.tasks),
      'Expected hosted web search usage in stream metadata or provider search-source annotations',
    )

    return {
      success: true,
      model: context.model,
      selectedApi,
      assistantMessage:
        finish.assistant.content.type === 'message' ? finish.assistant.content.data : '',
    }
  } finally {
    toolRpcExecutor.destroy()
    await ty.dispose('entry-node hosted web-search diagnostic complete')
    storage.destroy()
  }
}

testEntryNodeWebsearchProducesHostedSearchUsage.description =
  'Runs entryNode with websearch enabled and verifies that the hosted provider actually performed web search.'
testEntryNodeWebsearchProducesHostedSearchUsage.modelBased = true
