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
import { taskOrganizationTools, taskSearcher } from '../tools/TaskPlannerTool'
import { storageTools } from '../tools/gdrive'
import { appDevTools } from '../tools/webAppDev'
import { fileTools } from '../tools/fileTools'
import { localVectorStore } from '../tools/localVectorStore'
import { proceduralTools } from '../tools/proceduralGraphics'
import { wfcGenerator } from '../tools/wavefunctioncollapse'
import { createOAuthTool } from '../tools/authTools'
import type { EncryptedDataRow } from '../crudWrapper'
import {
  createCombinedCrudWrapper,
  createMapCrudWrapper,
  createPgLiteCrudWrapper,
  withSecretStore,
} from '../crudWrapper'
import { getDatabase } from '../pglite.api'
import { createDuplexChannel, createIframeMux } from '../frpBus'
import { testingTools } from '../tools/testTools'
import type { TaskyonMessage } from './apiTypes'
import { taskyonApi } from './api'

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
    ...testingTools,
    ...fileTools,
    ...taskOrganizationTools,
    ...storageTools,
    ...proceduralTools,
    createAddNewToolTool(),
    wfcGenerator,
    executePythonScript,
    localVectorStore,
    executeJavaScript,
    toolCreationWizard,
    //ragSearchTool,
    // TODO: finish the ragAddTool
    //ragAddTool,
    ...EnvironmentTools,
  ]

  const taskManagerInstance = await useTyTaskManager(llmSettings.vectorizationModel)

  const secretStore = withSecretStore(
    createCombinedCrudWrapper([
      createMapCrudWrapper(new Map<string, EncryptedDataRow>()),
      await createPgLiteCrudWrapper<EncryptedDataRow>(await getDatabase('taskyon'), {
        tableName: 'vault',
      }),
    ]),
    publicRecoveryKey,
  )

  console.log('finished taskManager initialization')

  // add tools which have access to the taskManagerInstance itself
  // TODO: we should get rid of this and supply an instanc eof the taskManager insider the tool
  // function itself if it is a "normal" function...
  const { chatCompletion, stream: chatCompletionStream } = await createChatCompletionTool(
    llmSettings,
    taskManagerInstance,
    apiKeys,
  )
  ToolList.push(
    chatCompletion,
    createToolSearcher(taskManagerInstance),
    createChooseTool(taskManagerInstance),
    taskSearcher(taskManagerInstance),
    createOAuthTool(secretStore),
  )
  taskManagerInstance.addDefaultTools(ToolList)
  void taskManagerInstance.updateToolDefinitions()

  // we use this as a global bus which make message iframes "postMessage" available
  // to taskyon & tools
  const iframeMultiPlexer = createIframeMux(5)

  // keys could porentially be reactive here, so in theory, when they change in the GUI,
  // taskyon should automatically pick up on this...
  console.log('starting taskyon worker')
  const { workerStream, workerStop, queueTask } = runTaskWorker(
    llmSettings,
    taskManagerInstance,
    secretStore,
    iframeMultiPlexer.all$,
  )

  // these stream defines that clients can use to communicate with taskyon
  // (e.g. iframes which are connected to taskyon)
  // we want full duplex communication here. And define two streams for this.
  // "outPort" is the outwards port which is used by 3rd party apps
  // to communicate with taskyon.
  // "inPort" is the other side of the channel and is used by taskyon itself
  const { a: outPort, b: inPort } = createDuplexChannel<TaskyonMessage>()

  taskyonApi(inPort, taskManagerInstance, llmSettings, apiKeys)

  return {
    // TODO: not sure, if the iframeMultiPlexer should be a taskyon functionality?
    //       it seems very "GUI"-oriented... maybe simply sending a message on "outPort"
    //       would be sufficient?
    connectMessageIframe: iframeMultiPlexer.attachIframe,
    taskManagerInstance,
    workerStream, // TODO: integrate with outPort
    chatCompletionStream, // TODO: integrate with outPort
    workerStop, // TODO: integrate with outPort
    queueTask, // TODO: integrate with outPort!
    secretStore, // TODO: integrate with outPort!
    outPort,
  }
}
