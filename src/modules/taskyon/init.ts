import type { CryptoSession, EncryptedDataRow, InternalTool } from '@taskyon/taskyon'
import { createCryptoSession, ToolBase } from '@taskyon/taskyon'
import { dump } from 'js-yaml'
import z from 'zod'
import { encryptCompressObject } from '../../../packages/taskyon/src/utils/fileUtils'
import {
  createCombinedCrudWrapper,
  createMapCrudWrapper,
  createPgLiteCrudWrapper,
  withSecretStore,
} from '../crudWrapper'
import {
  createDuplexChannel,
  createIframeMux,
  createPortApi,
  createTypeFilteredPort,
} from '../frpBus'
import { getDatabase } from '../pglite.api'
import { createOAuthTool } from '../tools/authTools'
import { createChatCompletionTool } from '../tools/chatCompletionTool'
import { devTools } from '../tools/devTools'
import { executeJavaScript } from '../tools/executeJavaScript'
import { executePythonScript } from '../tools/executePython'
import { fileTools } from '../tools/fileTools'
import { smallHelperTools } from '../tools/helperCollection'
import { localVectorStore } from '../tools/localVectorStore'
import { proceduralTools } from '../tools/proceduralGraphics'
import { taskOrganizationTools, taskSearcher } from '../tools/TaskPlannerTool'
import { testingTools } from '../tools/testTools'
import {
  createAddNewToolTool,
  createChooseTool,
  createToolSearcher,
  toolCreationWizard,
} from '../tools/toolTools'
import { useFullSmallTools } from '../tools/usefulSmallTools'
import { wfcGenerator } from '../tools/wavefunctioncollapse'
import { appDevTools } from '../tools/webAppDev'
import { TaskyonMessage } from './apiTypes'
import { useTyTaskManager } from './taskManager'
import { runTaskWorker } from './taskWorker'
import type { llmSettings } from './types'

export async function tyCore(
  // TODO: we want to save some settings "internally" and not in the GUI...
  llmSettings: llmSettings,
  apiKeys: { [key: string]: string },
  // with the Environment Tools we can provide a list of tools as closures which have access
  // to the environment in which taskyon is running (through closure variables
  // of this environment inside the tool).
  // E.g. the taskyon GUI and its state.
  // this way we can give taskyon access and the ability to read & change the environment
  // it is running in.
  EnvironmentTools: InternalTool[],
  cryptoSession?: CryptoSession,
) {
  // TODO: make webpack automatically add all tool files from /tools/*

  const ToolList: InternalTool[] = [
    ...smallHelperTools,
    ...appDevTools,
    ...useFullSmallTools,
    ...devTools,
    ...testingTools,
    ...fileTools,
    ...taskOrganizationTools,
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

  let cs: CryptoSession = cryptoSession ?? (await createCryptoSession())

  const taskManagerInstance = await useTyTaskManager(llmSettings.vectorizationModel)

  const secretStore = withSecretStore(
    createCombinedCrudWrapper([
      createMapCrudWrapper(new Map<string, EncryptedDataRow>()),
      await createPgLiteCrudWrapper<EncryptedDataRow>(await getDatabase('taskyon'), {
        tableName: 'vault',
      }),
    ]),
    () => cs.getUserPublicKey().publicKey,
  )

  // connect secretStore to cryptoSession
  secretStore.onSessionKey(({ respond }) => {
    console.log('importing fixed key for secretStore...')
    const key = cs.getSessionKey()
    respond(key)
  })

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

  // these stream defines that clients can use to communicate with taskyon
  // (e.g. iframes which are connected to taskyon)
  // we want full duplex communication here. And define two streams for this.
  // "outPort" is the outwards port which is used by 3rd party apps
  // to communicate with taskyon.
  // "inPort" is the other side of the channel and is used by taskyon itself
  const { x: outsidePort, y: insidePort } = createDuplexChannel<TaskyonMessage, TaskyonMessage>()

  // logging
  outsidePort.receive((msg) => {
    console.log('taskyon sending a message:', msg)
  })
  insidePort.receive((msg) => {
    console.log('taskyon receiving a message:', msg)
  })

  const { port: wport } = createTypeFilteredPort(insidePort, ['functionResponse'])

  //const { port: taskPort } = createZodPort(inPort, TaskWorkerMessage)

  // keys could porentially be reactive here, so in theory, when they change in the GUI,
  // taskyon should automatically pick up on this...
  console.log('starting taskyon worker')
  const { workerStream, workerStop, queueTask } = runTaskWorker(
    llmSettings,
    taskManagerInstance,
    secretStore,
    iframeMultiPlexer.all$,
    wport,
  )

  createPortApi(
    insidePort,
    TaskyonMessage,
    {
      task: async (msg) => {
        const tn = await taskManagerInstance.addPartialTask2Tree({
          ...msg.task,
          label: msg.origin ? [msg.origin] : undefined,
        })
        // push the last task to execution queue right away...
        if (msg.execute) {
          queueTask(tn.id)
        }
      },
      functionDescription: (msg) => {
        const newFunc: ToolBase = msg
        console.log(`functionDescription was sent by ${msg.origin}`, newFunc)
        void taskManagerInstance.addDefaultTools([newFunc])
        insidePort.send({
          type: 'status',
          data: {
            type: 'newtool',
            id: msg.name,
          },
        })
      },
      /*configurationMessage: (msg) => {
        const newConfig = msg.conf
        console.log('setting our configuration')
        if (newConfig.llmSettings) {
          // TODO: make sure, this function is only temporary and doesn't overwrite our actualy llmSettings...
          deepMergeReactive(llmSettings, newConfig.llmSettings, 'overwrite')
        }
      },*/
    },
    (msg) => console.warn('taskyon receiving unknown message', msg),
    (msg) => console.error('an error occured during handling of the message', msg),
  )

  taskManagerInstance.taskStream.subscribe(async ({ data: task, id }) => {
    // if tasks is not null, it was freshly created
    // TODO: only trigger upload on certain task events...
    if (task) {
      const archiveName = `${id}.tyt`

      // compress objects "locally" (for the test)
      const packed = await encryptCompressObject(
        task,
        archiveName,
        () => cs.getUserPublicKey()?.publicKey,
        () => cs.getSessionKey(),
      )
      console.log('created encrypted task file...', id)

      insidePort.send({
        type: 'addTasks',
        data: packed,
        info: archiveName,
        ids: [String(id)],
      })
    }
  })

  return {
    // TODO: not sure, if the iframeMultiPlexer should be a taskyon functionality?
    //       it seems very "GUI"-oriented... maybe simply sending a message on "outPort"
    //       would be sufficient?
    //       eah iframeMultiplexer should be replaced with something that uses ports...
    connectMessageIframe: iframeMultiPlexer.attachIframe,
    taskManagerInstance,
    workerStream, // TODO: integrate with outPort
    chatCompletionStream, // TODO: integrate with outPort
    workerStop, // TODO: integrate with outPort
    queueTask, // TODO: integrate with outPort!
    secretStore, // TODO: integrate with outPort!
    port: outsidePort,
    getCryptoSession: () => cs,
    setNewSession: (newCs: CryptoSession) => {
      cs = newCs
    },
  }
}

export type Taskyon = Awaited<ReturnType<typeof tyCore>>

/*function stringifyIfNotString(obj: unknown): string | undefined {
    if (typeof obj === 'undefined') return undefined;
    return typeof obj === 'string' ? obj : JSON.stringify(obj);
  }*/

export function createOpenAPIDocs() {
  /** This function creates openAPI docs for taskyon and saves them inside the public folder.
   *  the reason we're doing this her as msot clients will simply want to get the json and
   * not have to run the entire taskyon app in order to generate the docs...
   */
  // make sure to validate this using https://editor.swagger.io/

  /*const docs = new OpenApiGeneratorV3(registry.definitions).generateDocument(
    config,
  );*/

  console.log('generate docs...')

  const schemas = [ToolBase, TaskyonMessage].map((zType) =>
    z.toJSONSchema(zType, { unrepresentable: 'any' }),
  )

  const openapiDoc = {
    openapi: '3.0.0',
    info: {
      title: 'Taskyon API',
      version: '1.0.0', // you can pull this from your package.json
      description: 'Auto‑generated schema for Taskyon postmessage/iframe API',
    },
    paths: {}, // add path defs here if you have any
    components: {
      schemas,
    },
  }

  const openApiYaml = dump(openapiDoc)

  /*const destPath = path.resolve(__dirname, 'public/docs/openapi-docs.yml')
  fs.mkdirSync(path.dirname(destPath), { recursive: true })
  fs.writeFileSync(destPath, openApiYaml, { encoding: 'utf-8' })*/

  //console.log(`OpenAPI docs written to ${destPath}`)
  return openApiYaml
}
