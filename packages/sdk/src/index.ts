import { canonicalHash, type Sha256Hash } from '@taskyon/common/modules/canonicalHash'
import type { StreamSubscription } from '@taskyon/common/modules/frpBus'
import { createTaskyonBrowserCoreRuntime } from '@taskyon/runtime-browser/core'
import type { HostFetchContext } from '@taskyon/runtime-browser'
import type { FetchCapability } from '@taskyon/common/modules/webFetching/mediatedFetch'
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
import type {
  ChatCompletionProviderSettings,
  ChatCompletionStreamEvent,
  ToolIdentity,
  TyTaskStreamData,
} from '@taskyon/taskyon'
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

export type TaskyonIntegrationStream<T> = StreamSubscription<T>

export type TaskyonIntegrationProvider = ChatCompletionProviderSettings

export type TaskyonIntegrationRuntime = {
  client: TaskyonClient
  entryNode: partialTaskDraft
  hasProviderCredential: (provider: string) => Promise<boolean>
  chatCompletionStream: TaskyonIntegrationStream<ChatCompletionStreamEvent>
  workerStream: TaskyonIntegrationStream<TyTaskStreamData>
  stop: (reason?: string) => Promise<void>
}

const createIntegrationToolSetup = (hostFetch?: {
  fetch: (context: HostFetchContext, request: Request) => Promise<Response>
}): TyCoreToolSetup => ({
  baseTools: [],
  chatCompletionToolName: 'chatCompletion',
  createSessionTools: ({ taskManager, toolManager, artifactStore, toolchainConfig }) => {
    const createChatCompletion = (config: typeof toolchainConfig) => {
      const connection = resolveChatCompletionConnection(config.chatCompletion)
      return createChatCompletionTool(connection, {
        getTaskChain: taskManager.getTaskChain,
        getTaskChainSelection: taskManager.getTaskChainSelection,
        getTask: (id) => taskManager.getTask(id, { contentMode: 'hydrated' }),
        ...(artifactStore ? { getArtifact: artifactStore.get } : {}),
        listToolDefinitions: () => toolManager.listToolDefinitions(true),
        resolveToolDefinition: async (name, revision) =>
          (await toolManager.resolveTool(name, revision)).tool,
        metaUpsert: taskManager.metaUpsert,
        ...(hostFetch
          ? {
              fetch: (input, init) =>
                hostFetch.fetch(
                  {
                    kind: 'provider',
                    providerId: connection.provider,
                    recommendation: connection.recommendedTransport ?? 'direct',
                  },
                  new Request(input, init),
                ),
            }
          : {}),
      })
    }
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
  hostFetch?: {
    fetch: (context: HostFetchContext, request: Request) => Promise<Response>
    authorize: (tool: ToolIdentity, capability: FetchCapability) => Promise<boolean>
  }
}): Promise<TaskyonIntegrationRuntime> => {
  const entryTool = createStandardEntryNodeTool({
    name: options.entry.name,
    renderOptions: { hideChat: true, hideLlm: true },
    defaultAllowedTools: options.entry.allowedTools,
    extraContext: () => options.entry.context,
  })
  const entryNode = toolCall({ name: options.entry.name, arguments: {} })
  const hostFetch = options.hostFetch
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
    toolSetup: createIntegrationToolSetup(hostFetch),
    ...(hostFetch
      ? {
          allowPrivateSandboxFetch: true,
          authorizeSandboxFetch: ({ tool, capability }) => hostFetch.authorize(tool, capability),
          createFetchWithPolicy: () => (input, init, fetchOptions) =>
            hostFetch.fetch(
              { kind: 'tool', ...(fetchOptions ? { options: fetchOptions } : {}) },
              new Request(input, init),
            ),
        }
      : {}),
    cryptoSession: await initCryptoSessionFromBrowser(undefined, true, {
      namespace: options.cryptoNamespace ?? options.storageSessionId,
    }),
    storage: { kind: 'browser' },
  })

  try {
    const taskyon = await runtime.taskyon
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
      chatCompletionStream: taskyon.chatCompletionStream,
      workerStream: taskyon.workerStream,
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
