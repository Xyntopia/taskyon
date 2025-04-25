import { useTyTaskManager } from './taskManager'
import type { llmSettings } from './types'
import { runTaskWorker } from './taskWorker'
import type { InternalTool } from './tools'
// TODO: make webpack automatically add all tool files from /tools/*
import { executeJavaScript } from '../tools/executeJavaScript'
import { executePythonScript } from '../tools/executePython'
import { createChatCompletionTool } from '../tools/chatCompletionTool'
import {
  createAddNewToolTool,
  createChooseTool,
  createToolSearcher,
  toolCreationWizard,
} from '../tools/toolTools'
import { smallHelperTools } from '../tools/helperCollection'
import { useFullSmallTools } from '../tools/usefulSmallTools'
import { devTools } from '../tools/devTools'
import { taskOrganizationTools } from '../tools/TaskPlannerTool'
import { storageTools } from '../tools/gdrive'
import { appDevTools } from '../tools/webAppDev'
import { fileTools } from '../tools/fileTools'
import { localVectorStore } from '../tools/localVectorStore'

export async function initTaskyon(
  llmSettings: llmSettings,
  apiKeys: { [key: string]: string },
  // with the Environment Tools we can provide a list of tools as closures which have access
  // to the environment in which taskyon is running (through closure variables
  // of this environment inside the tool).
  // E.g. the taskyon GUI and its state.
  // this way we can give taskyon access and the ability to read & change the environment
  // it is running in.
  EnvironmentTools: InternalTool[],
  publicRecoveryKey: () => Promise<CryptoKey>,
) {
  const ToolList: InternalTool[] = [
    ...smallHelperTools,
    ...appDevTools,
    ...useFullSmallTools,
    ...devTools,
    ...fileTools,
    ...taskOrganizationTools,
    ...storageTools,
    executePythonScript,
    localVectorStore,
    executeJavaScript,
    toolCreationWizard,
    ...EnvironmentTools,
  ]

  const taskManagerInstance = await useTyTaskManager(
    ToolList,
    publicRecoveryKey,
    llmSettings.vectorizationModel,
  )
  console.log('finished taskManager initialization')

  // add tools which have access to the taskManagerInstance itself
  const { chatCompletion, stream: chatCompletionStream } = await createChatCompletionTool(
    llmSettings,
    taskManagerInstance,
    apiKeys,
  )
  ToolList.push(
    chatCompletion,
    createToolSearcher(taskManagerInstance),
    createChooseTool(taskManagerInstance),
    await createAddNewToolTool(),
  )
  void taskManagerInstance.updateToolDefinitions()

  // keys could porentially be reactive here, so in theory, when they change in the GUI,
  // taskyon should automatically pick up on this...
  console.log('starting taskyon worker')
  const { workerStream, workerStop, queueTask } = runTaskWorker(llmSettings, taskManagerInstance)

  return {
    taskManagerInstance,
    workerStream,
    chatCompletionStream,
    workerStop,
    queueTask,
  }
}
