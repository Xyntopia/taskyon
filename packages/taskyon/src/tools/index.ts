import type { TyCoreToolSetup } from '../core/init'
import { resolveChatCompletionConnection } from '../types/chatCompletion'
import { createDagGraphPatchTool } from '@taskyon/comp-dag/dagGraphTool'
import { createTool } from '../types/toolApi'
import { chatCompletionToolName, createChatCompletionTool } from './chatCompletionTool'
import { devTools } from './devTools'
import { executeJavaScript } from './executeJavaScript'
import { executePythonScript } from './executePython'
import { fileTools } from './fileTools'
import { smallHelperTools } from './helperCollection'
import { localVectorStore } from './localVectorStore'
import { proceduralTools } from './proceduralGraphics'
import { taskOrganizationTools, taskSearcher } from './TaskPlannerTool'
import { testingTools } from './testTools'
import {
  addNewTool,
  createMcpToolImporter,
  createToolSearcher,
  resolveAgentToolCatalog,
  toolCreationWizard,
} from './toolTools'
import { useFullSmallTools } from './usefulSmallTools'
import { appDevTools } from './webAppDev'
import { webResearchTools } from './webResearchTool'
import { wfcGenerator } from './wavefunctioncollapse'

export {
  resolveAgentToolCatalog,
  resolveInitialAgentToolCatalog,
  searchAgentToolCatalog,
} from './toolTools'

export const createDefaultTaskyonToolSetup = (options?: {
  unavailableToolNames?: ReadonlySet<string>
}): TyCoreToolSetup => ({
  baseTools: [
    ...smallHelperTools,
    ...appDevTools,
    ...useFullSmallTools,
    ...devTools,
    ...testingTools,
    ...fileTools,
    ...taskOrganizationTools,
    ...webResearchTools,
    ...proceduralTools,
    addNewTool,
    wfcGenerator,
    executePythonScript,
    executeJavaScript,
    createDagGraphPatchTool(createTool),
    toolCreationWizard,
  ],
  chatCompletionToolName,
  createSessionTools: ({ db, taskManager, toolchainConfig }) => {
    const createChatCompletion = (config: typeof toolchainConfig) =>
      createChatCompletionTool(resolveChatCompletionConnection(config.chatCompletion), {
        getTaskChain: taskManager.getTaskChain,
        getTask: taskManager.getTask,
        getFileMappingByUuid: taskManager.getFileMappingByUuid,
        getUploadedFile: taskManager.getUploadedFile,
        updateToolDefinitions: taskManager.updateToolDefinitions,
        metaUpsert: taskManager.metaUpsert,
      })
    const chatCompletion = createChatCompletion(toolchainConfig)

    return {
      tools: [
        localVectorStore(db),
        chatCompletion.chatCompletion,
        createToolSearcher(taskManager, (tools) =>
          resolveAgentToolCatalog(tools, options?.unavailableToolNames),
        ),
        createMcpToolImporter(taskManager),
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
