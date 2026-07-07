// we can compile this file to js to js using "yarn build:lib"

import type { Port } from '@taskyon/taskyon/api'
import {
  FunctionArguments as FunctionArgumentsSchema,
  createProtocolPort,
  createTaskyonClient,
  taskyonGuiProtocol,
} from '@taskyon/taskyon/api'
import {
  // from frp bux with only very few dependencies
  MessageChannelBridge, // utils/frpbus
  type ClientTool,
  registerToolRpcTools,
} from '@taskyon/taskyon/api'
import type {
  FunctionArguments,
  partialTyConfiguration,
  TaskyonGuiMessage,
  ToolRpcCreateContext,
} from '@taskyon/taskyon/api'
export {
  createChatCompletionTask,
  createClientTool,
  createTaskChainFromMarkdown,
  createMarkdownTaskChain,
  createSubtasksResult,
  createTool, // toolApi
  observeSubTaskStream,
  processTasksDetailed,
  runTasks,
  toolCall, // toolApi
  type partialTaskDraft,
} from '@taskyon/taskyon/api'
export type {
  ClientTool,
  ClientToolContext,
  TaskyonMessage,
  ToolRpcCreateContext,
  toolContext,
} from '@taskyon/taskyon/api'
export type { FunctionArguments, partialTyConfiguration, TaskyonGuiMessage }
export { REMOTE_FUNCTION_TIMEOUT_MS } from '@taskyon/taskyon/api'
export type { ToolBase as TaskyonToolDefinition } from '@taskyon/taskyon/api'
export {
  createPortClient,
  createProtocolPort,
  createTaskyonClient,
  MessageChannelBridge,
  taskyonGuiProtocol,
  taskyonProtocol,
} from '@taskyon/taskyon/api'

export async function callTaskyonTool(
  client: Pick<TyClient, 'port'>,
  name: string,
  args: Record<string, unknown>,
) {
  return await createTaskyonClient(client.port).callTool(name, FunctionArgumentsSchema.parse(args))
}

function safeClone<T>(data: T): T {
  try {
    return structuredClone(data)
  } catch {
    return JSON.parse(JSON.stringify(data))
  }
}

const waitForApiChannel = (iframe: HTMLIFrameElement): Promise<MessagePort> => {
  return new Promise<MessagePort>((resolve) => {
    let stopped = false

    const tryConnect = () => {
      if (stopped) return

      const channel = new MessageChannel()
      const targetOrigin = new URL(iframe.src, location.href).origin || '*' // '' for about:blank/file:
      //console.log('tyclient establishing iframe communication to', targetOrigin)

      // self‑destructing listener – removed automatically after it fires once
      const handleFirst: (ev: MessageEvent) => void = (ev) => {
        console.log('tyclient received first message from taskyon!', ev)
        stopped = true

        channel.port1.removeEventListener('message', handleFirst) // ⬅️ unsubscribe
        clearTimeout(retryTimer) // stop retry loop
        resolve(channel.port1) // hand over the port
      }

      channel.port1.addEventListener('message', handleFirst, { once: true })
      channel.port1.start() // ← wake the port so it can receive

      try {
        iframe.contentWindow?.postMessage({ type: 'initPort' }, targetOrigin, [channel.port2])
      } catch {
        /* DataCloneError can happen on FF if the iframe isn’t ready yet; ignore */
      }

      // retry after 200 ms if handshake hasn’t happened
      const retryTimer = setTimeout(() => {
        if (!stopped) {
          channel.port1.close() // avoid leaking unused ports
          channel.port2.close()
          tryConnect()
        }
      }, 200)
    }

    tryConnect()
  })
}

export interface TyClient {
  runTasks: ReturnType<typeof createTaskyonClient>['runTasks']
  port: Port<TaskyonGuiMessage, TaskyonGuiMessage>
  sendFiles: ReturnType<typeof createTaskyonClient>['sendFiles']
  reconfigure: (options: {
    name?: string
    persist?: boolean
    tools: ClientTool[]
    configuration: partialTyConfiguration
    bindingKey?: CryptoKey | string
    profileName?: string
    missingBindingKeyPolicy?: 'deriveFromProfile' | 'noBindingKey'
  }) => void
}

export async function initializeTaskyon(options: {
  name?: string
  persist?: boolean
  tools: ClientTool[]
  configuration: partialTyConfiguration
  bindingKey?: CryptoKey | string
  profileName?: string
  missingBindingKeyPolicy?: 'deriveFromProfile' | 'noBindingKey'
  iframeId?: string
  createToolContext?: ToolRpcCreateContext
}): Promise<TyClient> {
  console.log('initialize taskyon tyclient...')
  const resolvedName = options.name ?? 'taskyon'
  const resolvedProfileName = options.profileName ?? resolvedName
  const resolvedPersist = options.persist ?? true
  const resolvedMissingBindingKeyPolicy = options.missingBindingKeyPolicy ?? 'noBindingKey'

  const taskyon = document.getElementById(options.iframeId ?? 'taskyon') as HTMLIFrameElement

  const { x: clientSidePort, y: towardsIframe } = createProtocolPort(taskyonGuiProtocol)

  if (!taskyon || taskyon.tagName !== 'IFRAME' || taskyon.contentWindow === null)
    throw new Error(`we could not find the taskyon iframe with id: ${options.iframeId}`)

  console.log('make sure, we can ')
  // TODO: detect disconnect and reconnect!
  const iframeMessagePort = await waitForApiChannel(taskyon)
  MessageChannelBridge(towardsIframe, iframeMessagePort)
  const send = (msg: TaskyonGuiMessage) => {
    console.log('tyclient sending', msg)
    clientSidePort.send(safeClone(msg))
  }

  console.log('tyclient send our configuration!')
  send({
    type: 'configureTaskyonRequest',
    requestId: `configureTaskyon-${Date.now()}`,
    conf: options.configuration,
    persist: resolvedPersist,
    bindingKey: options.bindingKey,
    profileName: resolvedProfileName,
    missingBindingKeyPolicy: resolvedMissingBindingKeyPolicy,
    origin: window.location.origin,
    peerId: resolvedName,
  })

  clientSidePort.receive((msg: TaskyonGuiMessage) => console.log('tyclient received message', msg))
  const taskyonClient = createTaskyonClient(clientSidePort)
  const toolRpcExecutor = await registerToolRpcTools({
    port: clientSidePort,
    tools: options.tools,
    ...(options.createToolContext ? { createContext: options.createToolContext } : {}),
  })
  void toolRpcExecutor

  return {
    runTasks: taskyonClient.runTasks,
    port: clientSidePort,
    sendFiles: taskyonClient.sendFiles,
    reconfigure: (options: {
      name?: string
      persist?: boolean
      tools: ClientTool[]
      configuration: partialTyConfiguration
      bindingKey?: CryptoKey | string
      profileName?: string
      missingBindingKeyPolicy?: 'deriveFromProfile' | 'noBindingKey'
    }) => {
      const nextName = options.name ?? resolvedName
      send({
        type: 'configureTaskyonRequest',
        requestId: `configureTaskyon-${Date.now()}`,
        conf: options.configuration,
        persist: options.persist ?? resolvedPersist,
        bindingKey: options.bindingKey,
        profileName: options.profileName ?? nextName,
        missingBindingKeyPolicy: options.missingBindingKeyPolicy ?? resolvedMissingBindingKeyPolicy,
        origin: window.location.origin,
        peerId: nextName,
      })
    },
  }
}
