// we can compile this file to js to js using "yarn build:lib"

import type { FunctionCall, Port } from '@taskyon/taskyon/api'
import { REMOTE_FUNCTION_TIMEOUT_MS, processTasks, sendTasks } from '@taskyon/taskyon/api'
import {
  // from frp bux with only very few dependencies
  createDuplexChannel, // utis/frpbus
  MessageChannelBridge, // utils/frpbus
  type ClientTool,
} from '@taskyon/taskyon/api'
import { createSubtasksResult } from '../../taskyon/src/types/toolApi'
import type { ByType } from '../../taskyon/src/utils/tsHelpers'
// TODO: move this into some other part as well..  maybe into "GUI" types or somthing like that?
import type {
  partialTyConfiguration,
  TaskyonGuiMessage,
} from '../../../src/modules/taskyon/apiTypes'
import { sendFile } from '../../taskyon/src/types/apiTypes'
export {
  createChatCompletionTask,
  createTool, // toolApi
  observeSubTaskStream,
  processTasks,
  processTasksDetailed,
  sendTasks,
  toolCall, // toolApi
  type partialTaskDraft,
} from '@taskyon/taskyon/api'
export type { ClientTool, TaskyonMessage, toolContext } from '@taskyon/taskyon/api'
export type { partialTyConfiguration, TaskyonGuiMessage }
export { REMOTE_FUNCTION_TIMEOUT_MS }

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

async function handleFunctionExecution(
  args: FunctionCall['arguments'],
  tool: ClientTool,
  stopSignal: AbortSignal,
) {
  // with this we make sure, that we can also handle async functions :)
  const result = await tool.function(args, {
    taskChain: [],
    createSubtasksResult,
    getSecret: (name) => {
      console.log('tyclient get secret name', name)
      return Promise.resolve('N/A')
    },
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    setSecret: (name, _value) => {
      console.log('tyclient set secret name', name)
      return Promise.resolve()
    },
    stopSignal,
    toolId: 'N/A',
  })

  return result
}

export interface TyClient {
  sendTasks: ReturnType<typeof sendTasks>
  waitForTaskResult: ReturnType<typeof processTasks>
  port: Port<TaskyonGuiMessage, TaskyonGuiMessage>
  sendFile: (file: File) => Promise<string>
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
}): Promise<TyClient> {
  console.log('initialize taskyon tyclient...')
  const resolvedName = options.name ?? 'taskyon'
  const resolvedProfileName = options.profileName ?? resolvedName
  const resolvedPersist = options.persist ?? true
  const resolvedMissingBindingKeyPolicy = options.missingBindingKeyPolicy ?? 'noBindingKey'

  const toolMap = options.tools.reduce<Record<string, ClientTool>>((p, c) => {
    p[c.name] = c
    return p
  }, {})

  const taskyon = document.getElementById(options.iframeId ?? 'taskyon') as HTMLIFrameElement

  const controller = new AbortController()
  const { x: clientSidePort, y: towardsIframe } = createDuplexChannel<
    TaskyonGuiMessage,
    TaskyonGuiMessage
  >()

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
    type: 'configurationMessage',
    conf: options.configuration,
    persist: resolvedPersist,
    bindingKey: options.bindingKey,
    profileName: resolvedProfileName,
    missingBindingKeyPolicy: resolvedMissingBindingKeyPolicy,
    origin: window.location.origin,
    peerId: resolvedName,
  })

  const pendingToolAcks = new Set(options.tools.map((tool) => tool.name))
  const toolAckTimeoutMs = 10_000
  const toolAckPromise =
    pendingToolAcks.size === 0
      ? Promise.resolve()
      : new Promise<void>((resolve, reject) => {
          const statusStream = clientSidePort.receive.narrow(
            (
              msg: TaskyonGuiMessage,
            ): msg is ByType<'status', TaskyonGuiMessage> & {
              data: { type: 'newtool'; id: string }
            } =>
              msg.type === 'status' &&
              msg.data.type === 'newtool' &&
              typeof msg.data.id === 'string',
          )

          const timeout = setTimeout(() => {
            unsub()
            reject(
              new Error(
                `Timed out after ${toolAckTimeoutMs}ms waiting for tool registration: ${[
                  ...pendingToolAcks,
                ].join(', ')}`,
              ),
            )
          }, toolAckTimeoutMs)

          const unsub = statusStream((msg) => {
            pendingToolAcks.delete(msg.data.id)
            if (pendingToolAcks.size === 0) {
              clearTimeout(timeout)
              unsub()
              resolve()
            }
          })
        })

  console.log('tyclient sending our functions!')
  options.tools.forEach((t) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { function: _toolfunc, ...fdescr } = t
    send({
      type: 'functionDescription',
      ...fdescr,
    })
  })

  await toolAckPromise

  console.log('tyclient set up function listener!')

  clientSidePort.receive((msg: TaskyonGuiMessage) => console.log('tyclient received message', msg))
  clientSidePort.receive.narrow(
    (msg: TaskyonGuiMessage): msg is ByType<'functionCall', TaskyonGuiMessage> =>
      msg.type === 'functionCall',
  )(async (msg: ByType<'functionCall', TaskyonGuiMessage>) => {
    const tool = toolMap[msg.functionName]
    let tyres: TaskyonGuiMessage

    if (tool) {
      try {
        const res = await handleFunctionExecution(msg.arguments ?? {}, tool, controller.signal)
        tyres = {
          type: 'functionResponse',
          functionName: tool.name,
          requestId: msg.requestId,
          response: res,
        }
        console.log('tyclient tool send functionResponse to iframe', res, tool)
      } catch (error) {
        tyres = {
          type: 'functionResponse',
          functionName: tool.name,
          requestId: msg.requestId,
          error:
            typeof error === 'object' && error !== null && 'message' in error
              ? error.message
              : JSON.stringify(error),
        }
        console.error('tyclient tool error occurred', error)
      }
    } else {
      tyres = {
        type: 'functionResponse',
        functionName: msg.functionName,
        requestId: msg.requestId,
        error: `Tool not found: ${msg.functionName}`,
      }
      console.warn('tyclient received function call for unknown tool', msg.functionName)
    }
    send(tyres)
  })

  return {
    sendTasks: sendTasks(clientSidePort),
    waitForTaskResult: processTasks(clientSidePort),
    port: clientSidePort,
    sendFile: (file: File) => sendFile(clientSidePort.send)(file),
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
        type: 'configurationMessage',
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
