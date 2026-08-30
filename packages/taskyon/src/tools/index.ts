import type { TyCoreToolSetup } from '../core/init'
import { resolveChatCompletionConnection } from '../types/chatCompletion'
import { createDagGraphPatchTool } from '@taskyon/comp-dag/dagGraphTool'
import { createTool, type InternalTool } from '../types/toolApi'
import { chatCompletionToolName, createChatCompletionTool } from './chatCompletionTool'
import { chatCompletionRetryDelayTool } from './chatCompletionRetryTool'
import { devTools } from './devTools'
import { executeJavaScript } from './executeJavaScript'
import { executePythonScript } from './executePython'
import { createStorageTool } from './fileTools'
import { createDagGraphProjectTool } from './dagGraphProjectTool'
import type { TaskyonStorageClient } from '../api/storageProtocol'
import { smallHelperTools, webSearch } from './helperCollection'
import { localVectorStore } from './localVectorStore'
import { proceduralTools } from './proceduralGraphics'
import { taskOrganizationTools, taskSearcher } from './TaskPlannerTool'
import { testingTools } from './testTools'
import {
  createAddNewTool,
  createMcpToolImporter,
  createToolSearcher,
  resolveAgentToolCatalog,
  toolCreationWizard,
} from './toolTools'
import { useFullSmallTools } from './usefulSmallTools'
import { appDevTools } from './webAppDev'
import { webResearchTools } from './webResearchTool'
import { wfcGenerator } from './wavefunctioncollapse'
import { createStandardWorkspaceTools, type WorkspaceOperations } from './workspaceTools'

export {
  createTaskTreeAgentToolCatalog,
  resolveAgentToolCatalog,
  resolveInitialAgentToolCatalog,
  resolveTaskTreeAgentToolWindow,
  searchAgentToolCatalog,
} from './toolTools'
export * from './lambdaTool'

export const createDefaultTaskyonToolSetup = (options?: {
  unavailableToolNames?: ReadonlySet<string>
  storageClient?: TaskyonStorageClient
  prepareGraphRepository?: () => Promise<void>
  pythonTool?: InternalTool | null
  storageDownload?: typeof fetch
  workspaceOperations?: WorkspaceOperations
  chatCompletionFetch?: (
    connection: ReturnType<typeof resolveChatCompletionConnection>,
  ) => typeof fetch
}): TyCoreToolSetup => ({
  baseTools: [
    ...(options?.workspaceOperations
      ? createStandardWorkspaceTools(options.workspaceOperations)
      : []),
    ...smallHelperTools,
    webSearch,
    ...appDevTools,
    ...useFullSmallTools,
    ...devTools,
    ...testingTools,
    ...(options?.storageClient
      ? [
          createStorageTool(options.storageClient, options.storageDownload),
          createDagGraphProjectTool(options.storageClient, options.prepareGraphRepository),
        ]
      : []),
    ...taskOrganizationTools,
    ...webResearchTools,
    ...proceduralTools,
    wfcGenerator,
    ...(options?.pythonTool === null ? [] : [options?.pythonTool ?? executePythonScript]),
    executeJavaScript,
    createDagGraphPatchTool(createTool),
    toolCreationWizard,
    chatCompletionRetryDelayTool,
  ],
  chatCompletionToolName,
  createSessionTools: ({ db, taskManager, toolManager, artifactStore, toolchainConfig }) => {
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
        ...(options?.chatCompletionFetch ? { fetch: options.chatCompletionFetch(connection) } : {}),
      })
    }
    const chatCompletion = createChatCompletion(toolchainConfig)

    return {
      tools: [
        localVectorStore(db),
        chatCompletion.chatCompletion,
        createToolSearcher(toolManager, (tools) =>
          resolveAgentToolCatalog(tools, options?.unavailableToolNames),
        ),
        createAddNewTool(toolManager),
        createMcpToolImporter(toolManager),
        taskSearcher(taskManager),
      ],
      chatCompletionStream: chatCompletion.stream,
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
