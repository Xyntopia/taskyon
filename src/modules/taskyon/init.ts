import { useTyTaskManager } from './taskManager'
import type { TyTaskStreamData, llmSettings } from './types'
import type { TaskWorkerController } from './taskWorker'
import { runTaskWorker } from './taskWorker'
import type { InternalTool } from './tools'
import { loadFile } from 'src/modules/loadFiles'
// TODO: make webpack automatically add all tool files from /tools/*
import { executeJavaScript } from '../tools/executeJavaScript'
import { executePythonScript } from '../tools/executePython'
import { createAsyncQueue } from '../utils'
import { createChatCompletionTool } from '../tools/chatCompletionTool'
import type OpenAI from 'openai'
import {
  createAddNewToolTool,
  createChooseTool,
  createToolSearcher,
  toolCreationWizard,
} from '../tools/toolTools'
import { createStream } from '../frpBus'
import { smallHelperTools } from '../tools/helperCollection'
import { useFullSmallTools } from '../tools/useFullSmallTools'
import { devTools } from '../tools/devTools'
import { taskOrganizationTools } from '../tools/TaskPlannerTool'
import { storageTools } from '../tools/gdrive'

export async function initTaskyon(
  llmSettings: llmSettings,
  apiKeys: { [key: string]: string },
  taskWorkerController: TaskWorkerController,
  // with the Environment Tools we can provide a list of tools as closures which have access
  // to the environment in which taskyon is running (through closure variables
  // of this environment inside the tool).
  // E.g. the taskyon GUI and its state.
  // this way we can give taskyon access and the ability to read & change the environment
  // it is running in.
  EnvironmentTools: InternalTool[],
  streamCallback: (
    id: string,
    chunk: OpenAI.Chat.Completions.ChatCompletionChunk | undefined,
  ) => void,
  publicRecoveryKey: () => Promise<CryptoKey>,
) {
  const ToolList: InternalTool[] = [
    ...smallHelperTools,
    ...useFullSmallTools,
    ...devTools,
    ...taskOrganizationTools,
    ...storageTools,
    executePythonScript,
    // TODO: add local context(task) search
    // localVectorStoreSearch,
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
  ToolList.push(
    await createChatCompletionTool(
      llmSettings,
      taskManagerInstance,
      taskWorkerController.isInterrupted,
      apiKeys,
      streamCallback,
    ),
    createToolSearcher(taskManagerInstance),
    createChooseTool(taskManagerInstance),
    await createAddNewToolTool(),
    {
      function: async ({ filename }: { filename: string }) => {
        const file = await taskManagerInstance.getFileByName(filename)
        const fileContent = await loadFile(file)
        return fileContent
      },
      description: 'Get the contents of an uploaded file',
      name: 'getFileContent',
      parameters: {
        type: 'object',
        properties: {
          filename: {
            type: 'string',
          },
        },
        required: ['filename'],
      },
    },
  )
  void taskManagerInstance.updateToolDefinitions()

  // keys could porentially be reactive here, so in theory, when they change in the GUI,
  // taskyon should automatically pick up on this...
  console.log('starting taskyon worker')
  const taskProcessingStream = createStream<TyTaskStreamData>()

  const processTasksQueue = createAsyncQueue<string>()
  void runTaskWorker(
    processTasksQueue,
    llmSettings,
    taskManagerInstance,
    taskWorkerController,
    taskProcessingStream.emit,
  )

  return {
    taskManagerInstance,
    processTasksQueue,
    workerStream: taskProcessingStream.stream,
  }
}
