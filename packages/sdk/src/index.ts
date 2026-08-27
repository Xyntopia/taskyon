import { canonicalHash, type Sha256Hash } from '@taskyon/common/modules/canonicalHash'
import { createTaskyonBrowserCoreRuntime } from '@taskyon/runtime-browser/core'
import { initCryptoSessionFromBrowser } from '@taskyon/runtime-browser/crypto-session'
import {
  createExternalToolContext,
  createClientTool,
  hasTaskyonProviderCredential,
  registerToolRpcTools,
  setTaskyonProviderCredential,
  toolCall,
  type InternalTool,
  type TaskNode,
  type TaskyonClient,
  type partialTaskDraft,
} from '@taskyon/taskyon/api'
import { createChatCompletionTool, resolveChatCompletionConnection } from '@taskyon/taskyon/chat'
import type { TyCoreToolSetup } from '@taskyon/taskyon/runtime-core'
import {
  createStandardEntryNodeTool,
  type EntryNodePromptTemplates,
} from '@taskyon/taskyon/tools/entryNode'

export { canonicalHash, createClientTool, toolCall }
export { TASKYON_MODEL_CATALOG_URL } from '@taskyon/taskyon/taskyon-space'
export type { InternalTool, Sha256Hash, TaskNode, TaskyonClient, partialTaskDraft }
export type { EntryNodePromptTemplates }

export type TaskyonIntegrationProvider = {
  provider: string
  name: string
  model: string
  baseURL: string
  streamSupport: boolean
  defaultHeaders?: Record<string, string>
  routes: {
    chatCompletion: string
    models: string
  }
}

export type TaskyonIntegrationRuntime = {
  client: TaskyonClient
  entryNode: partialTaskDraft
  hasProviderCredential: (provider: string) => Promise<boolean>
  stop: (reason?: string) => Promise<void>
}

const createIntegrationToolSetup = (): TyCoreToolSetup => ({
  baseTools: [],
  chatCompletionToolName: 'chatCompletion',
  createSessionTools: ({ taskManager, toolManager, artifactStore, toolchainConfig }) => {
    const createChatCompletion = (config: typeof toolchainConfig) =>
      createChatCompletionTool(resolveChatCompletionConnection(config.chatCompletion), {
        getTaskChain: taskManager.getTaskChain,
        getTaskChainSelection: taskManager.getTaskChainSelection,
        getTask: (id) => taskManager.getTask(id, { contentMode: 'hydrated' }),
        ...(artifactStore ? { getArtifact: artifactStore.get } : {}),
        listToolDefinitions: () => toolManager.listToolDefinitions(true),
        resolveToolDefinition: async (name, revision) =>
          (await toolManager.resolveTool(name, revision)).tool,
        metaUpsert: taskManager.metaUpsert,
      })
    const initial = createChatCompletion(toolchainConfig)
    return {
      tools: [initial.chatCompletion],
      chatCompletionStream: initial.stream,
      recreateConfiguredTools: (nextConfig) => {
        const replacement = createChatCompletion(nextConfig)
        return {
          tools: [replacement.chatCompletion],
          chatCompletionStream: replacement.stream,
        }
      },
    }
  },
})

export const createTaskyonIntegrationRuntime = async (options: {
  entry: {
    name: string
    allowedTools: string[]
    context: string
    promptTemplates: EntryNodePromptTemplates
  }
  tools: InternalTool[]
  provider: TaskyonIntegrationProvider
  apiKey?: string
  storageSessionId: string
  cryptoNamespace?: string
  maxConcurrency?: number
}): Promise<TaskyonIntegrationRuntime> => {
  const entryTool = createStandardEntryNodeTool({
    name: options.entry.name,
    renderOptions: { hideChat: true, hideLlm: true },
    defaultAllowedTools: options.entry.allowedTools,
    extraContext: () => options.entry.context,
  })
  const entryNode = toolCall({ name: options.entry.name, arguments: {} })
  const runtime = createTaskyonBrowserCoreRuntime({
    llmSettings: () => ({
      entryFunction: options.entry.name,
      taskWorker: { maxConcurrency: options.maxConcurrency ?? 2 },
    }),
    entryNode: () => entryNode,
    toolchainConfig: {
      chatCompletion: options.provider,
      [options.entry.name]: {
        prompt_templates: options.entry.promptTemplates,
      },
    },
    storageSessionId: options.storageSessionId,
    toolSetup: createIntegrationToolSetup(),
    cryptoSession: await initCryptoSessionFromBrowser(undefined, true, {
      namespace: options.cryptoNamespace ?? options.storageSessionId,
    }),
    storage: { kind: 'browser' },
  })

  try {
    await runtime.taskyon
    if (options.apiKey) {
      await setTaskyonProviderCredential(runtime.host, options.provider.provider, options.apiKey)
    }
    const toolExecutor = await registerToolRpcTools({
      port: runtime.port,
      tools: [entryTool, ...options.tools],
      createContext: (call, stopSignal) =>
        createExternalToolContext(stopSignal, {
          getExecutionTaskChain: () => {
            if (!call.taskId) throw new Error('Integration tool call has no task id.')
            return runtime.client.task.getChain({ id: call.taskId })
          },
        }),
    })
    return {
      client: runtime.client,
      entryNode,
      hasProviderCredential: (provider) => hasTaskyonProviderCredential(runtime.host, provider),
      stop: async (reason?: string) => {
        toolExecutor.destroy()
        await runtime.stop(reason)
      },
    }
  } catch (error) {
    await runtime.stop('Taskyon integration runtime failed to start').catch(() => undefined)
    throw error
  }
}
