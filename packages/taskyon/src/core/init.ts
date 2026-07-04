import { dump } from 'js-yaml'
import z from 'zod'
import { chatCompletionToolName, createChatCompletionTool } from '../tools/chatCompletionTool'
import { devTools } from '../tools/devTools'
import {
  createDocumentationIndexTool,
  createTaskyonDocumentationTool,
} from '../tools/documentationTool'
import { executeJavaScript } from '../tools/executeJavaScript'
import { executePythonScript } from '../tools/executePython'
import { fileTools } from '../tools/fileTools'
import { smallHelperTools } from '../tools/helperCollection'
import { localVectorStore } from '../tools/localVectorStore'
import { proceduralTools } from '../tools/proceduralGraphics'
import { taskOrganizationTools, taskSearcher } from '../tools/TaskPlannerTool'
import { testingTools } from '../tools/testTools'
import {
  addNewTool,
  createMcpToolImporter,
  createToolSearcher,
  toolCreationWizard,
} from '../tools/toolTools'
import { useFullSmallTools } from '../tools/usefulSmallTools'
import { webResearchTools } from '../tools/webResearchTool'
import { wfcGenerator } from '../tools/wavefunctioncollapse'
import { appDevTools } from '../tools/webAppDev'
import { TaskyonMessage } from '../types/apiTypes'
import type { llmSettings } from '../types/profiles'
import { createSubtasksResult, type InternalTool } from '../types/toolApi'
import type { FunctionArguments } from '../types/tools'
import { ToolBase } from '../types/tools'
import { partialTaskDraft } from '../types/taskNode'
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
import type {
  extractStreamType,
  IframeMultiPlexer,
  Port,
  ProtocolMessage,
} from '@taskyon/shared/modules/frpBus'
import {
  createIframeMux,
  createMessagePortAdapter,
  createPortClient,
  createProtocolPort,
  createPortServer,
  createStream,
  createTypeFilteredPort,
  createUnavailableIframeMux,
} from '@taskyon/shared/modules/frpBus'
import { createProxyApi, createProxyFunction } from '../utils/objHelpers'
import { configureNodePgLiteDataDir, getDatabase } from '../utils/pglite.api'
import type { Thunk } from '../utils/tsHelpers'
import { MAX_REMOTE_FUNCTION_TIMEOUT_MS, taskyonProtocol } from '../api/taskyonProtocol'
import type { TyTaskManager } from './taskManager'
import { useTyTaskManager } from './taskManager'
import { generateSecretId } from './taskFunctionExecutor'
import { runTaskWorker } from './taskWorker'
import {
  createToolExecutionClient,
  registerToolRpcBroker,
  registerToolRpcExecutor,
  type ToolRpcFunctionCallMessage,
} from './toolRpc'
import { materializeTaskyonFunctionArguments } from './taskVariables'
import { createWithDefaults } from './tools'
import type { ReadonlyDeep } from 'type-fest'

type TaskyonProtocolMessage = ProtocolMessage<typeof taskyonProtocol>

function createApi(
  insidePort: Port<TaskyonProtocolMessage, TaskyonProtocolMessage>,
  taskManagerInstance: Thunk<TyTaskManager>,
  queueTask: (id: string) => void,
  cs: Thunk<CryptoSession>,
  sendEncryptedTasks?: Thunk<boolean>,
) {
  const taskyonApi = createPortClient(insidePort, taskyonProtocol)

  createPortServer(
    insidePort,
    taskyonProtocol,
    {
      createTask: async (msg) => {
        const tn = await taskManagerInstance().addPartialTask2Tree({
          ...msg.task,
          //label: msg.origin ? [msg.origin] : undefined,
        })
        // push the last task to execution queue right away...
        if (msg.execute) {
          queueTask(tn.id)
        }
      },
      createTaskChain: async (msg) => {
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
      registerTool: (msg) => {
        const newFunc: ToolBase = msg
        console.log('registerTool was sent', newFunc)
        void taskManagerInstance().addDefaultTools([newFunc])
        insidePort.send({
          type: 'status',
          data: {
            type: 'newtool',
            id: msg.name,
          },
        })
      },
      addFile: async (msg) => {
        const id = await taskManagerInstance().addFiles([msg.file], msg.store ?? 'memory')
        console.log('received file...', id, msg)
      },
      listTools: async (request) =>
        await taskManagerInstance().updateToolDefinitions(request.includeHidden),
      getTask: async ({ id }) => (await taskManagerInstance().getTask(id)) ?? null,
    },
    {
      onError: (error) =>
        console.error('an error occured during handling of the protocol command', error),
      onUnknownMessage: (msg) => console.warn('taskyon receiving unknown message', msg),
    },
  )

  let unsubscribeTaskStream: (() => void) | null = null
  const reconnectTaskStreamBridge = () => {
    unsubscribeTaskStream?.()
    unsubscribeTaskStream = taskManagerInstance().taskStream(async ({ data: task, id }) => {
      // if task is not null, it was freshly created/updated
      if (task) {
        insidePort.send({ type: 'taskCreated', task })

        if (sendEncryptedTasks?.()) {
          const archiveName = `${id}.tyt`

          const packed = await encryptCompressObject(
            task,
            archiveName,
            () => cs().getUserPublicKey()?.publicKey,
            () => cs().getSessionKey(),
          )
          console.log('created encrypted task file...', id)

          void taskyonApi
            .importTaskArchive({
              data: packed,
              info: archiveName,
              ids: [String(id)],
            })
            .catch((error) => {
              console.error('failed to send encrypted task archive to peer', error)
            })
        }
      }
    })
  }
  reconnectTaskStreamBridge()

  return {
    reconnectTaskStreamBridge,
  }
}

type CreateIframeMultiPlexer = () => IframeMultiPlexer

const createRuntimeIframeMux = (): IframeMultiPlexer => {
  if (typeof window !== 'undefined') return createIframeMux(5)
  return createUnavailableIframeMux(
    'Iframe message bridging is only available in browser runtimes.',
  )
}

const staticContext = (createIframeMultiPlexer: CreateIframeMultiPlexer) => {
  const ToolList: InternalTool[] = [
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
    //ragSearchTool,
    // TODO: finish the ragAddTool
    //ragAddTool,
  ]
  // we use this as a global bus which make message iframes "postMessage" available
  // to taskyon & tools
  const iframeMultiPlexer = createIframeMultiPlexer()

  // these stream defines that clients can use to communicate with taskyon
  // (e.g. iframes which are connected to taskyon)
  // we want full duplex communication here. And define two streams for this.
  // "outPort" is the outwards port which is used by 3rd party apps
  // to communicate with taskyon.
  // "inPort" is the other side of the channel and is used by taskyon itself
  const { x: outsidePort, y: insidePort } = createProtocolPort(taskyonProtocol)

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
    llmSettings: Thunk<ReadonlyDeep<llmSettings>>,
    entryNode: Thunk<ReadonlyDeep<partialTaskDraft>>,
    ToolList: InternalTool[],
    outsidePort: Port<TaskyonProtocolMessage, TaskyonProtocolMessage>,
    insidePort: Port<TaskyonProtocolMessage, TaskyonProtocolMessage>,
    iframeMultiPlexer: IframeMultiPlexer,
    toolchainConfig: Thunk<Record<string, FunctionArguments>>,
    options: { indexTaskVectors: boolean },
  ) =>
  async (cs: CryptoSession) => {
    // if our cryptoSession changes, we need to re-calculate everything below!
    //#####################  INIT CTX ####################
    const sessionKeyId = await cs.getSessionId()
    const db = await getDatabase(sessionKeyId)
    console.log('tycore starting new session with id:', sessionKeyId)
    const taskManagerInstance = await useTyTaskManager(db, {
      indexTaskVectors: options.indexTaskVectors,
    })
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
    const { chatCompletion, stream: chatCompletionStream } = createChatCompletionTool(() => {
      const settings = llmSettings()
      return {
        selectedApi: settings.selectedApi ?? 'taskyon',
        llmApis: settings.llmApis,
        siteUrl: settings.siteUrl,
      }
    }, taskManagerInstance)

    ToolList.push(
      localVectorStore(db),
      createDocumentationIndexTool(db),
      createTaskyonDocumentationTool(db),
      chatCompletion,
      createToolSearcher(taskManagerInstance),
      createMcpToolImporter(taskManagerInstance),
      taskSearcher(taskManagerInstance),
    )
    taskManagerInstance.addDefaultTools(ToolList)
    await taskManagerInstance.updateToolDefinitions()
    //const { port: taskPort } = createZodPort(inPort, TaskWorkerMessage)

    // keys could porentially be reactive here, so in theory, when they change in the GUI,
    // taskyon should automatically pick up on this...
    console.log('starting taskyon worker')
    const { port: workerport } = createTypeFilteredPort(insidePort, ['functionResponse'])
    const { port: coreToolRpcPort } = createTypeFilteredPort(outsidePort, [
      'functionCall',
      'functionCancel',
    ])
    const coreToolExecutor = registerToolRpcExecutor({
      port: coreToolRpcPort,
      getTool: async (name) => {
        const { tool } = await taskManagerInstance.getToolDefinition(name)
        if (tool?.function || tool?.code) return tool
        return undefined
      },
      createContext: async (call, stopSignal) => {
        const { tool, def } = await taskManagerInstance.getToolDefinition(call.functionName)
        if (!tool) throw new Error(`Tool not found: ${call.functionName}`)
        const toolId = await generateSecretId(def?.id, tool)
        const executionTask = call.taskId ? await taskManagerInstance.getTask(call.taskId) : null
        const messagePortAdapter = executionTask
          ? createMessagePortAdapter(
              iframeMultiPlexer.all$.filter((msg) => {
                return msg.id === executionTask.parentID || msg.id === executionTask.priorID
              }),
            )
          : undefined
        return {
          context: {
            getExecutionTaskChain: () => {
              if (!call.taskId) {
                throw new Error(
                  'getExecutionTaskChain is not available for this tool call because no task id was provided.',
                )
              }
              return taskManagerInstance.getTaskChain(call.taskId)
            },
            createSubtasksResult,
            getSecret: async (name, askNew, saveNew = true) => {
              console.log('get secret name', name)
              const secr = await secretStore.getSecret(toolId, name, askNew, saveNew)
              return secr ?? null
            },
            setSecret: async (name, value) => {
              console.log('set secret name', name)
              await secretStore.setSecret(toolId, name, value)
            },
            stopSignal,
            toolId,
            ...(messagePortAdapter
              ? {
                  messagePort: messagePortAdapter.port,
                }
              : {}),
          },
          cleanup: () => messagePortAdapter?.destroy(),
        }
      },
    })
    const prepareToolCall = async (call: ToolRpcFunctionCallMessage) => {
      const { tool } = await taskManagerInstance.getToolDefinition(call.functionName)
      if (!tool) {
        throw new Error(
          `The function '${call.functionName}' is not available in tools. Please select a valid toolname.`,
        )
      }
      const rawArguments = call.arguments ?? {}
      const funcSettings = toolchainConfig()[call.functionName]
      const materializedArguments = await materializeTaskyonFunctionArguments(rawArguments, {
        surface: 'execution',
        getTaskById: taskManagerInstance.getTask,
      })
      return {
        name: call.functionName,
        arguments: {
          ...createWithDefaults(tool.parameters),
          ...(funcSettings || {}),
          ...rawArguments,
          ...materializedArguments,
        },
      }
    }
    const continuationTask = partialTaskDraft.parse(entryNode())
    const { workerStream, toolRpcPort, workerStop, queueTask } = runTaskWorker(
      taskManagerInstance,
      continuationTask,
      continuationTask,
    )
    const workerToolBroker = registerToolRpcBroker({
      workerPort: toolRpcPort,
      toolPort: workerport,
      prepareFunctionCall: prepareToolCall,
      defaultTimeoutMs: MAX_REMOTE_FUNCTION_TIMEOUT_MS,
    })
    const toolExecutionClient = createToolExecutionClient(workerport)
    //##################### END INIT CTX #################
    return {
      chatCompletionStream,
      workerStream,
      callTool: (name: string, args: FunctionArguments) => toolExecutionClient.callTool(name, args),
      workerStop: (message: string) => {
        console.log('tycore stopping all tasks:', message)
        workerStop(message)
        workerToolBroker.stop(message)
        coreToolExecutor.stop(message)
      },
      queueTask,
      taskManagerInstance,
      secretStore,
    }
  }

export async function tyCore(
  // TODO: we want to save some settings "internally" and not in the GUI...
  //       but then....   we als want taskyon to be as "stateless" as possible..
  llmSettings: Thunk<ReadonlyDeep<llmSettings>>,
  entryNode: Thunk<ReadonlyDeep<partialTaskDraft>>,
  toolchainConfig: Thunk<Record<string, FunctionArguments>>,
  initialCryptoSession?: CryptoSession,
  options?: {
    createIframeMultiPlexer?: CreateIframeMultiPlexer
    indexTaskVectors?: boolean
    nodePgLiteDataDir?: string
  },
) {
  // TODO: make webpack automatically add all tool files from /tools/*

  configureNodePgLiteDataDir(
    options?.nodePgLiteDataDir ? (name) => `${options.nodePgLiteDataDir}/${name}` : undefined,
  )

  const { outsidePort, insidePort, iframeMultiPlexer, ToolList } = staticContext(
    options?.createIframeMultiPlexer ?? createRuntimeIframeMux,
  )

  // TODO: encapsulate this into a "createCtx" function
  //       which also handles the initilaization of ctx..
  let cs = initialCryptoSession ?? (await createCryptoSession())

  // dynamic context needs to be-recreated whenever our session changes!
  // TODO: in order to improve performance, its probably a good idea to move
  //       more of the dynamic context into the static context..
  const ctxCreator = dynamicContext(
    llmSettings,
    entryNode,
    [...ToolList],
    outsidePort,
    insidePort,
    iframeMultiPlexer,
    toolchainConfig,
    { indexTaskVectors: options?.indexTaskVectors !== false },
  )

  // TODO: we need to integrate all of these with our API.
  //       ideally, the API would be the only thing that communicates with the outside!
  let ctx = await ctxCreator(cs)

  // receive events
  // the Api is static and never needs to change!
  const apiBridge = createApi(
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
    ctx.workerStream(workerStream.emit)
    ctx.chatCompletionStream(chatCompletionStream.emit)
    ctx.taskManagerInstance.taskStream(taskStream.emit)
  }

  connectStreams()

  const setNewSession = async (newCs: CryptoSession) => {
    console.log('tycore setting new crypto session...')
    cs = newCs
    // we need to re-initialize our entire context in order to have access to key store, decrypted data
    // etc with the new session...
    ctx = await ctxCreator(cs)

    connectStreams()
    apiBridge.reconnectTaskStreamBridge()

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
    workerStop: (message: string) => ctx.workerStop(message),
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
        'addPartialTask2Tree',
        'getMeta',
        'metaUpsert',
        'metaLiveRead',
        'getTaskChain',
        // TODO: md taskchain and yaml loading might be better as "utility-functions?" without a dependency
        //       on taskManagerinstance..
        'addMdTaskChain',
        'loadYamlConversation',
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
        'getUploadedFile',
        'getFileMappingByUuid',
        'addFiles',
        // TODO: also the following functionsnot sure, maybe we can generalize backup a bit more?
        'getJsonTaskBackup',
        'addTaskBackup',
        // TODO:  what do these funcitons here do?
        //        I think they bulid a treeview from tasks..  but it might make sense
        //        to move them out of tycore and have them as seperate functions!
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
