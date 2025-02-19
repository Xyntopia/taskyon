import { useTyTaskManager } from './taskManager'
import type { TaskNode, TaskNodeMeta, llmSettings } from './types'
import type { TaskyonDatabase } from './rxdb'
import { createTaskyonDatabase } from './rxdb'
import type { TaskWorkerController } from './taskWorker'
import { runTaskWorker } from './taskWorker'
import type { InternalTool } from './tools'
import { loadFile } from 'src/modules/loadFiles'
// TODO: make webpack automatically add all tool files from /tools/*
import { executeJavaScript } from '../tools/executeJavaScript'
import { executePythonScript } from '../tools/executePython'
import { createAsyncQueue, toLowerCaseKeys } from '../utils'
import { createChatCompletionTool } from '../tools/chatCompletionTool'
import { getDatabase } from '../pglite.api'
import { createEnhancedCrudWrapper } from '../crudWrapper'
import type OpenAI from 'openai'
import { toolCreationWizard } from '../tools/toolManagement'

export async function initTaskyon(
  llmSettings: llmSettings,
  apiKeys: { [key: string]: string },
  taskWorkerController: TaskWorkerController,
  logError: (message: string) => void,
  // we explicitly provide a tasklist here, this gives us the chance to provide a reactive
  // value in order to get updates to the list of tasks immediatly reflected in the UI.
  TaskList: Map<string, TaskNode>,
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
) {
  const ToolList: InternalTool[] = [
    executePythonScript,
    // TODO: add local context(task) search
    // localVectorStoreSearch,
    executeJavaScript,
    toolCreationWizard,
    ...EnvironmentTools,
  ]

  const pgldb = await getDatabase('taskyon')
  const debugDb = await createEnhancedCrudWrapper<TaskNodeMeta>(
    pgldb,
    {
      tableName: 'debugDb',
    },
    new Map<string, TaskNodeMeta>(),
  )

  // TODO: possibly move this into an "upper level?"
  console.log('initializing taskyondb')
  const taskyonDBInstance: TaskyonDatabase = await createTaskyonDatabase()
  console.log('initializing task manager')
  const taskManagerInstance = useTyTaskManager(
    TaskList,
    ToolList,
    taskyonDBInstance,
    debugDb,
    llmSettings.vectorizationModel,
  )
  console.log('finished taskManager initialization')

  // add tools which have access to the taskManagerInstance itself
  ToolList.push(
    await createChatCompletionTool(
      llmSettings,
      taskManagerInstance,
      taskWorkerController,
      apiKeys,
      streamCallback,
    ),
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
    {
      name: 'searchTools',
      description: `You can use this tool to do the following:
- Get a list of all tool names.
- Get the definition of a single tool including source code, if available. (not case sensitive)`,
      longDescription: `You can use this tool to do the following:
- Get a list of all tool names.
- Get the definition of a single tool including source code, if available. (not case sensitive)`,
      parameters: {
        type: 'object',
        properties: {
          toolName: {
            type: 'string',
            default: undefined,
            description: `- If toolname is provided: return tool definition for tool with the same name.
- If undefined or we can not find the toolname: return a list of all tools`,
          },
        },
        required: [],
      },
      function: async ({ toolName }: { toolName?: string }) => {
        const allTools = toLowerCaseKeys(await taskManagerInstance.updateToolDefinitions())
        if (toolName && allTools[toolName.toLowerCase()]) return allTools[toolName.toLowerCase()]
        else return allTools
      },
    },
  )
  void taskManagerInstance.updateToolDefinitions()

  // keys could porentially be reactive here, so in theory, when they change in the GUI,
  // taskyon should automatically pick up on this...
  console.log('starting taskyon worker')
  const processTasksQueue = createAsyncQueue<string>()
  void runTaskWorker(processTasksQueue, llmSettings, taskManagerInstance, taskWorkerController)

  return { taskManagerInstance, processTasksQueue }
}
