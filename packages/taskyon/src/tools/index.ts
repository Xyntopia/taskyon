import type { ReadonlyDeep } from 'type-fest'
import type { TyCoreToolSetup } from '../core/init'
import type { llmSettings } from '../types/profiles'
import type { Thunk } from '../utils/tsHelpers'
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

export { resolveAgentToolCatalog } from './toolTools'

const createChatCompletionSettings = (llmSettings: Thunk<ReadonlyDeep<llmSettings>>) => {
  const settings = llmSettings()
  return {
    selectedApi: settings.selectedApi ?? 'taskyon',
    llmApis: settings.llmApis,
    siteUrl: settings.siteUrl,
  }
}

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
    toolCreationWizard,
  ],
  chatCompletionToolName,
  createSessionTools: ({ db, llmSettings, taskManager }) => {
    const { chatCompletion, stream } = createChatCompletionTool(
      () => createChatCompletionSettings(llmSettings),
      {
        getTaskChain: taskManager.getTaskChain,
        getTask: taskManager.getTask,
        getFileMappingByUuid: taskManager.getFileMappingByUuid,
        getUploadedFile: taskManager.getUploadedFile,
        updateToolDefinitions: taskManager.updateToolDefinitions,
        metaUpsert: taskManager.metaUpsert,
      },
    )
    return {
      tools: [
        localVectorStore(db),
        chatCompletion,
        createToolSearcher(taskManager, (tools) =>
          resolveAgentToolCatalog(tools, options?.unavailableToolNames),
        ),
        createMcpToolImporter(taskManager),
        taskSearcher(taskManager),
      ],
      chatCompletionStream: stream,
    }
  },
})
