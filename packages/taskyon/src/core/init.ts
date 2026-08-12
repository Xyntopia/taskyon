import type { ChatCompletionStreamEvent } from '../types/chatCompletion'
import { TyToolchainConfig, type llmSettings } from '../types/profiles'
import { createSubtasksResult, type InternalTool } from '../types/toolApi'
import { FunctionArguments } from '../types/tools'
import { ToolBase, type ToolIdentity } from '../types/tools'
import { partialTaskDraft } from '../types/taskNode'
import {
  createCombinedCrudWrapper,
  createMapCrudWrapper,
  createPgLiteCrudWrapper,
  type SecretStore,
  withSecretStore,
} from '../utils/crudWrapper'
import type { CryptoSession } from '../utils/cryptoSession'
import { createCryptoSession } from '../utils/cryptoSession'
import type { EncryptedDataRow } from '../utils/encrypt'
import { encryptCompressObject } from '../utils/fileUtils'
import type { Port, ProtocolMessage, Stream } from '@taskyon/common/modules/frpBus'
import {
  createPortClient,
  createProtocolPort,
  createPortServer,
  createStream,
  createTypeFilteredPort,
} from '@taskyon/common/modules/frpBus'
import {
  createIframeMux,
  createUnavailableIframeMux,
  type IframeMultiPlexer,
} from '@taskyon/common/modules/frpBusWeb'
import { createProxyApi, createProxyFunction } from '../utils/objHelpers'
import { configureNodePgLiteDataDir, getDatabase } from '../utils/pglite.api'
import type { TyPGDB } from '../utils/pglite.api'
import type { Thunk } from '../utils/tsHelpers'
import {
  MAX_REMOTE_FUNCTION_TIMEOUT_MS,
  taskyonHostProtocol,
  taskyonProtocol,
} from '../api/taskyonProtocol'
import { createTaskyonApiDescription } from '../api/taskyonOpenApi'
import type { TaskManagerStorage, TyTaskManager } from './taskManager'
import { createPgLiteTaskManagerStorage, useTyTaskManager } from './taskManager'
import type { ArtifactStore } from './artifactStore'
import { findCallingToolReference, generateSecretId } from './taskFunctionExecutor'
import { runTaskWorker, type TyTaskStreamData } from './taskWorker'
import { summarizeProtocolMessageForLog } from './protocolLogging'
import {
  createToolExecutionClient,
  registerToolRpcBroker,
  registerToolRpcExecutor,
  type ToolRpcFunctionCallMessage,
} from './toolRpc'
import { materializeTaskyonFunctionArguments } from './taskVariables'
import { createMediatedFetch, type FetchCapability } from '../security/mediatedFetch'
import { createToolManager, type ToolManager } from './toolManager'
import { createWithDefaults } from './tools'
import type { ReadonlyDeep } from 'type-fest'

type TaskyonProtocolMessage = ProtocolMessage<typeof taskyonProtocol>
type TaskyonHostMessage = ProtocolMessage<typeof taskyonHostProtocol>
type TaskStreamEvent = Parameters<TyTaskManager['taskStream']>[0] extends (
  event: infer Event,
) => void | Promise<void>
  ? Event
  : never

type SessionStreamObservers = {
  worker: (event: TyTaskStreamData) => void
  chatCompletion: (event: ChatCompletionStreamEvent) => void
  task: Parameters<TyTaskManager['taskStream']>[0]
}

type TaskManagerStorageFactory = (args: {
  sessionId: string
  db: Awaited<ReturnType<typeof getDatabase>>
}) => Promise<TaskManagerStorage> | TaskManagerStorage
type ArtifactStoreFactory = (args: { sessionId: string }) => Promise<ArtifactStore> | ArtifactStore
type TaskyonDatabaseFactory = (name: string) => Promise<TyPGDB>

export type TyCoreToolSetup = {
  baseTools: InternalTool[]
  chatCompletionToolName: string
  createSessionTools: (deps: {
    db: TyPGDB
    taskManager: TyTaskManager
    toolManager: ToolManager
    artifactStore?: ArtifactStore
    toolchainConfig: TyToolchainConfig
  }) => {
    tools: InternalTool[]
    chatCompletionStream?: Stream<ChatCompletionStreamEvent>
    recreateConfiguredTools?: (toolchainConfig: TyToolchainConfig) => {
      tools: InternalTool[]
      chatCompletionStream?: Stream<ChatCompletionStreamEvent>
    }
  }
}

function createApi(
  insidePort: Port<TaskyonProtocolMessage, TaskyonProtocolMessage>,
  taskManagerInstance: TyTaskManager,
  toolManager: ToolManager,
  artifactStore: ArtifactStore | undefined,
  queueTask: (id: string) => void,
) {
  const unsubscribeApiServer = createPortServer(
    insidePort,
    taskyonProtocol,
    {
      peer: {
        ping: ({ nonce }) => ({
          ok: true,
          protocol: 'taskyon.core',
          version: '1',
          status: 'ready',
          ...(nonce ? { nonce } : {}),
        }),
      },
      discovery: {
        describe: async () =>
          createTaskyonApiDescription(taskyonProtocol, await toolManager.listToolDefinitions(true)),
      },
      task: {
        create: async (msg) => {
          const tn = await taskManagerInstance.addPartialTask2Tree({
            ...msg.task,
            //label: msg.origin ? [msg.origin] : undefined,
          })
          // push the last task to execution queue right away...
          if (msg.execute) {
            queueTask(tn.id)
          }
        },
        createChain: async (msg) => {
          console.log('received tasks:', msg)
          const ts = await Promise.all(
            msg.tasks.map(
              async (t) =>
                await taskManagerInstance.addPartialTask2Tree({
                  ...t,
                  //label: msg.origin ? [msg.origin] : undefined,
                }),
            ),
          )
          console.log('executing tasks', ts)
          if (msg.execute) ts.forEach((t) => queueTask(t.id))
        },
        get: async ({ id }) => (await taskManagerInstance.getTask(id)) ?? null,
        getIdChain: async ({ id, maxFollow, selection }) =>
          await taskManagerInstance.getTaskIdChain(id, maxFollow, selection),
        getChain: async ({ id, maxFollow, selection }) =>
          await taskManagerInstance.getTaskChain(id, maxFollow, selection),
        getChildChains: async ({ id }) => await taskManagerInstance.getChildChains(id),
      },
      tools: {
        register: async (msg) => {
          const newFunc: ToolBase = msg
          console.log('registerTool was sent', newFunc)
          await toolManager.installTool(newFunc, { approveReplacement: true })
          insidePort.send({
            type: 'status',
            data: {
              type: 'newtool',
              id: msg.name,
            },
          })
        },
        list: async (request) => await toolManager.listToolDefinitions(request.includeHidden),
        resolve: async ({ name, revision }) => {
          const { tool, identity } = await toolManager.resolveTool(name, revision)
          return tool && identity ? { tool: ToolBase.parse(tool), identity } : null
        },
      },
      files: {
        add: async ({ file }) => {
          if (!artifactStore) throw new Error('Artifact storage is not available in this runtime.')
          return await artifactStore.put(file)
        },
      },
    },
    {
      onError: (error) =>
        console.error('an error occured during handling of the protocol command', error),
      onUnknownMessage: (msg) => console.warn('taskyon receiving unknown message', msg),
    },
  )
  insidePort.send({ type: 'taskyonReady' })

  return unsubscribeApiServer
}

type CreateIframeMultiPlexer = () => IframeMultiPlexer

const createRuntimeIframeMux = (): IframeMultiPlexer => {
  if (typeof window !== 'undefined') return createIframeMux(5)
  return createUnavailableIframeMux(
    'Iframe message bridging is only available in browser runtimes.',
  )
}

const matchesToolInteraction = (
  payload: unknown,
  request: { tool?: string | undefined; token?: string | undefined },
) => {
  if (!request.tool && !request.token) return true
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return false
  const interaction = payload as { tool?: unknown; token?: unknown }
  return (
    (!request.tool || interaction.tool === request.tool) &&
    (!request.token || interaction.token === request.token)
  )
}

const staticContext = (createIframeMultiPlexer: CreateIframeMultiPlexer) => {
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
  const { x: hostPort, y: insideHostPort } = createProtocolPort(taskyonHostProtocol)

  // logging
  outsidePort.receive((msg) => {
    console.log('taskyon sending a message:', summarizeProtocolMessageForLog(msg))
  })
  insidePort.receive((msg) => {
    console.log('taskyon receiving a message:', summarizeProtocolMessageForLog(msg))
  })

  return {
    outsidePort,
    insidePort,
    hostPort,
    insideHostPort,
    iframeMultiPlexer,
  }
}

const dynamicContext =
  (
    llmSettings: Thunk<ReadonlyDeep<llmSettings>>,
    entryNode: Thunk<ReadonlyDeep<partialTaskDraft>>,
    toolSetup: TyCoreToolSetup,
    outsidePort: Port<TaskyonProtocolMessage, TaskyonProtocolMessage>,
    insidePort: Port<TaskyonProtocolMessage, TaskyonProtocolMessage>,
    insideHostPort: Port<TaskyonHostMessage, TaskyonHostMessage>,
    iframeMultiPlexer: IframeMultiPlexer,
    options: {
      indexTaskVectors: boolean
      taskSearchVectorizer: 'static-multilingual' | 'transformer-minilm'
      databaseFactory: TaskyonDatabaseFactory
      secretStore?: SecretStore
      sendEncryptedTasks?: Thunk<boolean>
      streamObservers: SessionStreamObservers
      taskManagerStorageFactory?: TaskManagerStorageFactory
      artifactStoreFactory?: ArtifactStoreFactory
      authorizeSandboxFetch?: (args: {
        tool: ToolIdentity
        capability: FetchCapability
      }) => Promise<boolean>
      authorizePopup?: (args: {
        tool: ToolIdentity
        target: 'custom-html' | `origin:${string}`
      }) => Promise<boolean>
    },
  ) =>
  async (cs: CryptoSession, initialToolchainConfig: TyToolchainConfig) => {
    // if our cryptoSession changes, we need to re-calculate everything below!
    //#####################  INIT CTX ####################
    const sessionKeyId = await cs.getSessionId()
    const db = await options.databaseFactory(sessionKeyId)
    console.log('tycore starting new session with id:', sessionKeyId)
    const storage = options.taskManagerStorageFactory
      ? await options.taskManagerStorageFactory({ sessionId: sessionKeyId, db })
      : await createPgLiteTaskManagerStorage(db)
    const toolManager = createToolManager(storage.tools)
    const artifactStore = options.artifactStoreFactory
      ? await options.artifactStoreFactory({ sessionId: sessionKeyId })
      : undefined
    const taskManagerInstance = await useTyTaskManager(db, {
      indexTaskVectors: options.indexTaskVectors,
      taskSearchVectorizer: options.taskSearchVectorizer,
      storage,
      resolveTool: toolManager.resolveTool,
    })
    console.log('tycore finished taskManager initialization')
    const secretStore =
      options.secretStore ??
      withSecretStore(
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

    const runtimeConfiguration = {
      toolchainConfig: initialToolchainConfig,
    }
    const sessionTools = toolSetup.createSessionTools({
      db,
      taskManager: taskManagerInstance,
      toolManager,
      ...(artifactStore ? { artifactStore } : {}),
      toolchainConfig: runtimeConfiguration.toolchainConfig,
    })
    const sessionToolList = [...toolSetup.baseTools, ...sessionTools.tools]
    await toolManager.addDefaultTools(sessionToolList)
    let unsubscribeChatCompletion =
      sessionTools.chatCompletionStream?.(options.streamObservers.chatCompletion) ?? (() => {})
    let configureRuntimePromise = Promise.resolve()
    const configureRuntime = (toolchainConfig: TyToolchainConfig) => {
      const nextConfiguration = TyToolchainConfig.parse(toolchainConfig)
      const nextRun = configureRuntimePromise
        .catch(() => undefined)
        .then(async () => {
          const refreshed = sessionTools.recreateConfiguredTools?.(nextConfiguration)
          const unsubscribeReplacementStream =
            refreshed?.chatCompletionStream?.(options.streamObservers.chatCompletion) ?? (() => {})
          try {
            await toolManager.addDefaultTools(refreshed?.tools ?? [])
          } catch (error) {
            unsubscribeReplacementStream()
            throw error
          }
          if (refreshed) {
            unsubscribeChatCompletion()
            unsubscribeChatCompletion = unsubscribeReplacementStream
          }
          runtimeConfiguration.toolchainConfig = nextConfiguration
        })
      configureRuntimePromise = nextRun
      return nextRun
    }
    const unsubscribeHostApiServer = createPortServer(insideHostPort, taskyonHostProtocol, {
      runtime: {
        configure: async ({ toolchainConfig }) => {
          try {
            await configureRuntime(toolchainConfig)
            return { ok: true as const }
          } catch (error) {
            return {
              ok: false as const,
              error: error instanceof Error ? error.message : String(error),
            }
          }
        },
      },
    })
    //const { port: taskPort } = createZodPort(inPort, TaskWorkerMessage)

    // keys could porentially be reactive here, so in theory, when they change in the GUI,
    // taskyon should automatically pick up on this...
    console.log('starting taskyon worker')
    const workerPortFilter = createTypeFilteredPort(insidePort, [
      'functionProgress',
      'functionResponse',
    ])
    const workerport = workerPortFilter.port
    const coreToolRpcPortFilter = createTypeFilteredPort(outsidePort, [
      'functionCall',
      'functionCancel',
    ])
    const coreToolRpcPort = coreToolRpcPortFilter.port
    const coreToolExecutor = registerToolRpcExecutor({
      port: coreToolRpcPort,
      getTool: async (name, call) => {
        const { tool } = await toolManager.resolveTool(name, call?.toolRevision)
        if (tool?.function || tool?.code) return tool
        return undefined
      },
      createContext: async (call, stopSignal) => {
        const { tool, identity } = await toolManager.resolveTool(
          call.functionName,
          call.toolRevision,
        )
        if (!tool) throw new Error(`Tool not found: ${call.functionName}`)
        const toolId = await generateSecretId(identity?.revision, tool)
        const executionTask = call.taskId ? await taskManagerInstance.getTask(call.taskId) : null
        const interactionIds = new Set(
          [executionTask?.parentID, executionTask?.priorID].filter(
            (id): id is string => typeof id === 'string',
          ),
        )
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
            getCallingToolId: async () => {
              if (!call.taskId) return null
              const chain = await taskManagerInstance.getTaskChain(call.taskId)
              const caller = findCallingToolReference(chain, call.functionName)
              if (!caller) return null
              const { tool: callerTool, identity: callerIdentity } = await toolManager.resolveTool(
                caller.name,
                caller.revision,
              )
              return callerTool
                ? await generateSecretId(callerIdentity?.revision, callerTool)
                : null
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
            fetch: createMediatedFetch({
              authorize: (capability) =>
                identity
                  ? (options.authorizeSandboxFetch?.({ tool: identity, capability }) ??
                    Promise.resolve(false))
                  : Promise.resolve(false),
              signal: stopSignal,
            }),
            requestPopup: ({ target }) =>
              identity
                ? (options.authorizePopup?.({ tool: identity, target }) ?? Promise.resolve(false))
                : Promise.resolve(false),
            waitForInteraction: async (request = {}) => {
              if (!executionTask) {
                throw new Error('UI interaction is unavailable without an execution task.')
              }
              return await iframeMultiPlexer.all$
                .filter(
                  (message) =>
                    interactionIds.has(message.id) &&
                    matchesToolInteraction(message.payload, request),
                )
                .map((message) => message.payload)
                .wait({ signal: stopSignal })
            },
          },
          cleanup: () => undefined,
        }
      },
    })
    const prepareToolCall = async (call: ToolRpcFunctionCallMessage) => {
      const { tool, identity } = await toolManager.resolveTool(call.functionName, call.toolRevision)
      if (!tool) {
        throw new Error(
          `The function '${call.functionName}' is not available in tools. Please select a valid toolname.`,
        )
      }
      const rawArguments = call.arguments ?? {}
      const funcSettings = runtimeConfiguration.toolchainConfig[call.functionName]
      const materializedArguments = await materializeTaskyonFunctionArguments(rawArguments, {
        surface: 'execution',
        getTaskById: taskManagerInstance.getTask,
      })
      return {
        name: call.functionName,
        ...(identity ? { toolRevision: identity.revision } : {}),
        arguments: FunctionArguments.parse({
          ...createWithDefaults(tool.parameters),
          ...(funcSettings || {}),
          ...rawArguments,
          ...materializedArguments,
        }),
      }
    }
    const continuationTask = partialTaskDraft.parse(entryNode())
    const entryNodeToolName =
      continuationTask.content.type === 'functioncall'
        ? continuationTask.content.data.name
        : 'entryNode'
    const taskWorkerConfig = llmSettings().taskWorker
    const { workerStream, toolRpcPort, cancelCurrentRun, workerSettled, queueTask } = runTaskWorker(
      taskManagerInstance,
      continuationTask,
      continuationTask,
      taskWorkerConfig?.maxConcurrency ?? 4,
      new Set([toolSetup.chatCompletionToolName, entryNodeToolName]),
    )
    const workerToolBroker = registerToolRpcBroker({
      workerPort: toolRpcPort,
      toolPort: workerport,
      prepareFunctionCall: prepareToolCall,
      defaultTimeoutMs: MAX_REMOTE_FUNCTION_TIMEOUT_MS,
    })
    const toolExecutionClient = createToolExecutionClient(workerport)
    const taskyonApi = createPortClient(insidePort, taskyonProtocol)
    const unsubscribeApiServer = createApi(
      insidePort,
      taskManagerInstance,
      toolManager,
      artifactStore,
      (id: string) => queueTask(id),
    )
    let disposed = false
    const unsubscribeTaskStreamBridge = taskManagerInstance.taskStream(
      async ({ data: task, id }) => {
        // if task is not null, it was freshly created/updated
        if (task) {
          insidePort.send({ type: 'taskCreated', task })

          if (options.sendEncryptedTasks?.()) {
            const archiveName = `${id}.tyt`

            const packed = await encryptCompressObject(
              task,
              archiveName,
              () => cs.getUserPublicKey()?.publicKey,
              () => cs.getSessionKey(),
            )
            console.log('created encrypted task file...', id)

            void taskyonApi.archive
              .importTask({
                data: packed,
                info: archiveName,
                ids: [String(id)],
              })
              .catch((error) => {
                console.error('failed to send encrypted task archive to peer', error)
              })
          }
        }
      },
    )
    const unsubscribeSessionStreams = [
      workerStream(options.streamObservers.worker),
      taskManagerInstance.taskStream(options.streamObservers.task),
    ]
    //##################### END INIT CTX #################
    return {
      callTool: (name: string, args: FunctionArguments) => toolExecutionClient.callTool(name, args),
      runtimeConfiguration,
      cancelCurrentRun: (message: string) => {
        console.log('tycore stopping all tasks:', message)
        cancelCurrentRun(message)
        workerToolBroker.stop(message)
        coreToolExecutor.stop(message)
      },
      dispose: async (message: string) => {
        if (disposed) return
        disposed = true
        console.log('tycore disposing session context:', message)
        unsubscribeChatCompletion()
        unsubscribeSessionStreams.forEach((unsubscribe) => unsubscribe())
        unsubscribeApiServer()
        unsubscribeHostApiServer()
        cancelCurrentRun(message)
        workerToolBroker.stop(message)
        coreToolExecutor.stop(message)
        await workerSettled()
        unsubscribeTaskStreamBridge()
        workerToolBroker.destroy()
        coreToolExecutor.destroy()
        workerPortFilter.destroy()
        coreToolRpcPortFilter.destroy()
      },
      queueTask,
      taskManagerInstance,
      toolManager,
      artifactStore,
      secretStore,
    }
  }

export async function tyCore(
  // TODO: we want to save some settings "internally" and not in the GUI...
  //       but then....   we als want taskyon to be as "stateless" as possible..
  llmSettings: Thunk<ReadonlyDeep<llmSettings>>,
  entryNode: Thunk<ReadonlyDeep<partialTaskDraft>>,
  initialToolchainConfig: TyToolchainConfig,
  initialCryptoSession?: CryptoSession,
  options?: {
    toolSetup?: TyCoreToolSetup
    createIframeMultiPlexer?: CreateIframeMultiPlexer
    indexTaskVectors?: boolean
    taskSearchVectorizer?: 'static-multilingual' | 'transformer-minilm'
    databaseFactory?: TaskyonDatabaseFactory
    nodePgLiteDataDir?: string
    secretStore?: SecretStore
    taskManagerStorageFactory?: TaskManagerStorageFactory
    artifactStoreFactory?: ArtifactStoreFactory
    authorizeSandboxFetch?: (args: {
      tool: ToolIdentity
      capability: FetchCapability
    }) => Promise<boolean>
    authorizePopup?: (args: {
      tool: ToolIdentity
      target: 'custom-html' | `origin:${string}`
    }) => Promise<boolean>
  },
) {
  configureNodePgLiteDataDir(
    options?.nodePgLiteDataDir
      ? (name) => `${options.nodePgLiteDataDir}/${encodeURIComponent(name)}`
      : undefined,
  )

  const { outsidePort, insidePort, hostPort, insideHostPort, iframeMultiPlexer } = staticContext(
    options?.createIframeMultiPlexer ?? createRuntimeIframeMux,
  )
  const workerStream = createStream<TyTaskStreamData>()
  const chatCompletionStream = createStream<ChatCompletionStreamEvent>()
  const taskStream = createStream<TaskStreamEvent>()
  const toolSetup = options?.toolSetup ?? {
    baseTools: [],
    chatCompletionToolName: 'chatCompletion',
    createSessionTools: () => ({ tools: [] }),
  }
  const parsedInitialToolchainConfig = TyToolchainConfig.parse(initialToolchainConfig)

  // TODO: encapsulate this into a "createCtx" function
  //       which also handles the initilaization of ctx..
  let cs = initialCryptoSession ?? (await createCryptoSession())

  // dynamic context needs to be-recreated whenever our session changes!
  // TODO: in order to improve performance, its probably a good idea to move
  //       more of the dynamic context into the static context..
  const ctxCreator = dynamicContext(
    llmSettings,
    entryNode,
    toolSetup,
    outsidePort,
    insidePort,
    insideHostPort,
    iframeMultiPlexer,
    {
      indexTaskVectors: options?.indexTaskVectors !== false,
      taskSearchVectorizer: options?.taskSearchVectorizer ?? 'static-multilingual',
      databaseFactory: options?.databaseFactory ?? getDatabase,
      ...(options?.secretStore ? { secretStore: options.secretStore } : {}),
      streamObservers: {
        worker: workerStream.emit,
        chatCompletion: chatCompletionStream.emit,
        task: taskStream.emit,
      },
      ...(options?.taskManagerStorageFactory
        ? { taskManagerStorageFactory: options.taskManagerStorageFactory }
        : {}),
      ...(options?.artifactStoreFactory
        ? { artifactStoreFactory: options.artifactStoreFactory }
        : {}),
      ...(options?.authorizeSandboxFetch
        ? { authorizeSandboxFetch: options.authorizeSandboxFetch }
        : {}),
      ...(options?.authorizePopup ? { authorizePopup: options.authorizePopup } : {}),
    },
  )

  // TODO: we need to integrate all of these with our API.
  //       ideally, the API would be the only thing that communicates with the outside!
  let ctx = await ctxCreator(cs, parsedInitialToolchainConfig)

  const replaceSessionContext = async (newCs: CryptoSession) => {
    const currentToolchainConfig = ctx.runtimeConfiguration.toolchainConfig
    await ctx.dispose('switching crypto session')
    cs = newCs
    // we need to re-initialize our entire context in order to have access to key store, decrypted data
    // etc with the new session...
    ctx = await ctxCreator(cs, currentToolchainConfig)

    console.log('tycore finished initializing new session...')
  }

  const setNewSession = async (newCs: CryptoSession) => {
    console.log('tycore setting new crypto session...')
    await replaceSessionContext(newCs)
  }

  const api = {
    // TODO: this is only an intermediate solution...
    //        * we need to connect/disconnect streams
    //        * we need to add functions that are nedded outside "directly" to the expoted functions
    //        * we need to move all of these functions into a message port duplex API.
    chatCompletionStream: chatCompletionStream.stream,
    workerStream: workerStream.stream,
    taskStream: taskStream.stream,
    cancelCurrentRun: (message: string) => ctx.cancelCurrentRun(message),
    dispose: (message: string) => ctx.dispose(message),
    getArtifact: async (attachment: Parameters<ArtifactStore['get']>[0]) =>
      await ctx.artifactStore?.get(attachment),
    installTool: async (tool: InternalTool) => {
      const identity = await ctx.toolManager.installTool(tool, { approveReplacement: true })
      insidePort.send({ type: 'status', data: { type: 'newtool', id: identity.name } })
      return identity
    },
    updateChatCompletionApiKey: async (key: string, value?: string) => {
      const { tool, identity } = await ctx.toolManager.resolveTool(toolSetup.chatCompletionToolName)
      if (tool) {
        const toolId = await generateSecretId(identity?.revision, tool)
        if (!value) await ctx.secretStore.deleteSecret(toolId, key)
        else await ctx.secretStore.setSecret(toolId, key, value)
      }
    },
    // we are creating the proxyApi here so that from the outside every function always gets proxied
    // to the most up-to-date taskmanager instance... We are also flattening it at the same time!
    ...createProxyApi(
      () => ctx.taskManagerInstance,
      [
        'convertTaskIDs',
        'getMeta',
        'metaUpsert',
        'metaLiveRead',
        // TODO: md taskchain and yaml loading might be better as "utility-functions?" without a dependency
        //       on taskManagerinstance..
        'loadYamlConversation',
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
        // TODO: also the following functionsnot sure, maybe we can generalize backup a bit more?
        'getJsonTaskBackup',
        'addTaskBackup',
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
    hostPort,
    getCryptoSession: () => cs,
    setNewSession,
  }
  return api
}

export type Taskyon = Awaited<ReturnType<typeof tyCore>>
