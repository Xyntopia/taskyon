import { dump } from 'js-yaml'
import z from 'zod'
import { createOAuthTool } from '../tools/authTools'
import {
  chatCompletionToolName,
  createChatCompletionTask,
  createChatCompletionTool,
} from '../tools/chatCompletionTool'
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
import { TaskyonMessage } from '../types/apiTypes'
import type { llmSettings } from '../types/profiles'
import type { InternalTool } from '../types/toolApi'
import { ToolBase } from '../types/tools'
import {
  createCombinedCrudWrapper,
  createMapCrudWrapper,
  createPgLiteCrudWrapper,
  withSecretStore,
} from '../utils/crudWrapper'
import type { CryptoSession } from '../utils/cryptoSession'
import { createCryptoSession } from '../utils/cryptoSession'
import type { EncryptedDataRow } from '../utils/encrypt'
import { encryptCompressObject } from '../utils/fileUtils'
import type { extractStreamType, IframeMultiPlexer, Port } from '../utils/frpBus'
import {
  createDuplexChannel,
  createIframeMux,
  createPortApi,
  createStream,
  createTypeFilteredPort,
} from '../utils/frpBus'
import { createProxyApi, createProxyFunction } from '../utils/objHelpers'
import { getDatabase } from '../utils/pglite.api'
import type { Thunk } from '../utils/tsHelpers'
import type { TyTaskManager } from './taskManager'
import { useTyTaskManager } from './taskManager'
import { generateSecretId, runTaskWorker } from './taskWorker'

function createApi(
  insidePort: Port<TaskyonMessage, TaskyonMessage>,
  taskManagerInstance: Thunk<TyTaskManager>,
  queueTask: (id: string) => void,
  cs: Thunk<CryptoSession>,
  sendEncryptedTasks?: Thunk<boolean>,
) {
  createPortApi(
    insidePort,
    TaskyonMessage,
    {
      task: async (msg) => {
        const tn = await taskManagerInstance().addPartialTask2Tree({
          ...msg.task,
          //label: msg.origin ? [msg.origin] : undefined,
        })
        // push the last task to execution queue right away...
        if (msg.execute) {
          queueTask(tn.id)
        }
      },
      tasks: async (msg) => {
        console.log('received tasks:', msg)
        const ts = await Promise.all(
          msg.tasks.map(
            async (t) =>
              await taskManagerInstance().addPartialTask2Tree({
                ...t,
                //label: msg.origin ? [msg.origin] : undefined,
              }),
          ),
        )
        console.log('executing tasks', ts)
        // push the last task to execution queue right away...
        if (msg.execute) ts.forEach((t) => queueTask(t.id))
      },
      functionDescription: (msg) => {
        const newFunc: ToolBase = msg
        console.log(`functionDescription was sent by ${msg.origin}`, newFunc)
        void taskManagerInstance().addDefaultTools([newFunc])
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

  // send events...
  taskManagerInstance().taskStream.subscribe(async ({ data: task, id }) => {
    // if tasks is not null, it was freshly created
    // TODO: only trigger upload on certain task events...
    if (task) {
      insidePort.send({ type: 'taskCreated', task })

      if (sendEncryptedTasks?.()) {
        const archiveName = `${id}.tyt`

        // compress objects "locally" (for the test)
        const packed = await encryptCompressObject(
          task,
          archiveName,
          () => cs().getUserPublicKey()?.publicKey,
          () => cs().getSessionKey(),
        )
        console.log('created encrypted task file...', id)

        insidePort.send({
          type: 'addTasks',
          data: packed,
          info: archiveName,
          ids: [String(id)],
        })
      }
    }
  })
}

const staticContext = () => {
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
    executeJavaScript,
    toolCreationWizard,
    //ragSearchTool,
    // TODO: finish the ragAddTool
    //ragAddTool,
  ]
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

  return {
    outsidePort,
    insidePort,
    iframeMultiPlexer,
    ToolList,
  }
}

const dynamicContext =
  (
    llmSettings: Thunk<llmSettings>,
    ToolList: InternalTool[],
    insidePort: Port<TaskyonMessage, TaskyonMessage>,
    iframeMultiPlexer: IframeMultiPlexer,
  ) =>
  async (cs: CryptoSession) => {
    // if our cryptoSession changes, we need to re-calculate everything below!
    //#####################  INIT CTX ####################
    const sessionKeyId = await cs.getSessionId()
    const db = await getDatabase(sessionKeyId)
    console.log('tycore starting new session with id:', sessionKeyId)
    const taskManagerInstance = await useTyTaskManager(db, llmSettings().vectorizationModel)
    console.log('tycore finished taskManager initialization')
    const secretStore = withSecretStore(
      createCombinedCrudWrapper([
        createMapCrudWrapper(new Map<string, EncryptedDataRow>()),
        await createPgLiteCrudWrapper<EncryptedDataRow>(db, {
          tableName: 'vault',
        }),
      ]),
      () => cs.getUserPublicKey().publicKey,
      () => {
        //console.log('importing fixed key for secretStore...')
        return cs.getSessionKey()
      },
    )

    // add tools which have access to the taskManagerInstance itself and need to be
    // regenerated for each session
    // TODO: we should get rid of this and supply an instanc eof the taskManager insider the tool
    // function itself if it is a "normal" function...
    // TODO: get rid of llmSettings completly!
    const { chatCompletion, stream: chatCompletionStream } = await createChatCompletionTool(
      llmSettings,
      taskManagerInstance,
    )

    ToolList.push(
      localVectorStore(db),
      chatCompletion,
      createToolSearcher(taskManagerInstance),
      createChooseTool(taskManagerInstance),
      taskSearcher(taskManagerInstance),
      createOAuthTool(secretStore),
    )
    taskManagerInstance.addDefaultTools(ToolList)
    await taskManagerInstance.updateToolDefinitions()
    //const { port: taskPort } = createZodPort(inPort, TaskWorkerMessage)

    // keys could porentially be reactive here, so in theory, when they change in the GUI,
    // taskyon should automatically pick up on this...
    console.log('starting taskyon worker')
    const { port: workerport } = createTypeFilteredPort(insidePort, ['functionResponse'])
    const { workerStream, stopAllTasks, queueTask } = runTaskWorker(
      taskManagerInstance,
      secretStore,
      iframeMultiPlexer.all$,
      workerport,
      llmSettings().maxAutonomousTasks,
      createChatCompletionTask({
        goal: 'AnalyzeToolResult',
        llmTools: llmSettings().enableOpenAiTools,
      }),
      createChatCompletionTask({
        goal: 'AnalyzeError',
        llmTools: llmSettings().enableOpenAiTools,
      }),
    )
    //##################### END INIT CTX #################
    return {
      chatCompletionStream,
      workerStream,
      stopAllTasks,
      queueTask,
      taskManagerInstance,
      secretStore,
    }
  }

export async function tyCore(
  // TODO: we want to save some settings "internally" and not in the GUI...
  //       but then....   we als want taskyon to be as "stateless" as possible..
  llmSettings: Thunk<llmSettings>,
  // with the Environment Tools we can provide a list of tools as closures which have access
  // to the environment in which taskyon is running (through closure variables
  // of this environment inside the tool).
  // E.g. the taskyon GUI and its state.
  // this way we can give taskyon access and the ability to read & change the environment
  // it is running in.
  EnvironmentTools: InternalTool[],
  initialCryptoSession?: CryptoSession,
) {
  // TODO: make webpack automatically add all tool files from /tools/*

  const { outsidePort, insidePort, iframeMultiPlexer, ToolList } = staticContext()

  // TODO: encapsulate this into a "createCtx" function
  //       which also handles the initilaization of ctx..
  let cs = initialCryptoSession ?? (await createCryptoSession())

  // dynamic context needs to be-recreated whenever our session changes!
  // TODO: in order to improve performance, its probably a good idea to move
  //       more of the dynamic context into the static context..
  const ctxCreator = dynamicContext(
    llmSettings,
    [...EnvironmentTools, ...ToolList],
    insidePort,
    iframeMultiPlexer,
  )

  // TODO: we need to integrate all of these with our API.
  //       ideally, the API would be the only thing that communicates with the outside!
  let ctx = await ctxCreator(cs)

  // receive events
  // the Api is static and never needs to change!
  createApi(
    insidePort,
    () => ctx.taskManagerInstance,
    (id: string) => ctx.queueTask(id),
    () => cs,
  )

  const workerStream = createStream<extractStreamType<typeof ctx.workerStream>>()
  const chatCompletionStream = createStream<extractStreamType<typeof ctx.chatCompletionStream>>()
  const taskStream = createStream<extractStreamType<typeof ctx.taskManagerInstance.taskStream>>()

  const connectStreams = () => {
    // re-connect all streams
    ctx.workerStream.subscribe(workerStream.emit)
    ctx.chatCompletionStream.subscribe(chatCompletionStream.emit)
    ctx.taskManagerInstance.taskStream.subscribe(taskStream.emit)
  }

  connectStreams()

  const setNewSession = async (newCs: CryptoSession) => {
    console.log('tycore setting new crypto session...')
    cs = newCs
    // we need to re-initialize our entire context in order to have access to key store, decrypted data
    // etc with the new session...
    ctx = await ctxCreator(cs)

    connectStreams()

    console.log('tycore finished initializing new session...')
  }

  const api = {
    // TODO: this is only an intermediate solution...
    //        * we need to connect/disconnect streams
    //        * we need to add functions that are nedded outside "directly" to the expoted functions
    //        * we need to move all of these functions into a message port duplex API.
    chatCompletionStream: chatCompletionStream.stream,
    workerStream: workerStream.stream,
    taskStream: taskStream.stream,
    workerStop: (message: string) => ctx.stopAllTasks(message),
    queueTask: (id: string) => ctx.queueTask(id),
    // updating and getting ApiKeys for chat completion has a special
    // treatment here, because we need it very often in our UI
    updateChatCompletionApiKey: async (key: string, value?: string) => {
      const { tool, def } = await ctx.taskManagerInstance.getToolDefinition(chatCompletionToolName)
      if (tool) {
        const toolId = await generateSecretId(def?.id, tool)
        if (!value) await ctx.secretStore.deleteSecret(toolId, key)
        else await ctx.secretStore.setSecret(toolId, key, value)
      }
    },
    // we are creating the proxyApi here so that from the outside every function always gets proxied
    // to the most up-to-date taskmanager instance... We are also flattening it at the same time!
    ...createProxyApi(
      () => ctx.taskManagerInstance,
      [
        'getTask',
        'getTaskIdChain',
        'convertTaskIDs',
        'updateToolDefinitions',
        'addPartialTask2Tree',
        'getMeta',
        'metaUpsert',
        'metaLiveRead',
        'getTaskChain',
        // TODO: md taskchain and yaml loading might be better as "utility-functions?" without a dependency
        //       on taskManagerinstance..
        'addMdTaskChain',
        'loadYamlConversation',
        'addTaskChain',
        'getToolDefinition',
        'countTasks',
        'countVecs',
        'syncVectorIndexWithTasks',
        'resetTaskVectors',
        'filteredVectorSearch',
        'searchSimilarTasks',
        'filterSearch',
        'findSiblingLeafTasks',
        'deleteTaskThread',
        'deleteTask',
        'getOpfsUploadedFile',
        'getFileMappingByUuid',
        'addFiles',
        // TODO: also the following functionsnot sure, maybe we can generalize backup a bit more?
        'getJsonTaskBackup',
        'addTaskBackup',
        // TODO:  what do these funcitons here do?
        //        I think they bulid a treeview from tasks..  but it might make sense
        //        to move them out of tycore and have them as seperate functions!
        'buildTaskTreeNode',
        'buildSiblingChain',
        'deleteAllTasks',
      ],
    ),
    ...createProxyApi(
      () => ctx.secretStore,
      [
        'getSecret',
        'setSecret',
        'onAskNewSecret',
        'listSecretIds',
        'listSecrets',
        'deleteSecret',
        'deleteAllFromId',
      ],
    ),
    // TODO: not sure, if the iframeMultiPlexer should be a taskyon functionality?
    //       it seems very "GUI"-oriented... maybe simply sending a message on "outPort"
    //       would be sufficient?
    //       eah iframeMultiplexer should be replaced with something that uses ports...
    connectMessageIframe: createProxyFunction(() => iframeMultiPlexer.attachIframe),

    port: outsidePort,
    getCryptoSession: () => cs,
    setNewSession,
  }
  return api
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
