// we can compile this file to js to js using "yarn build:lib"

import type { FunctionCall, Port } from '@taskyon/taskyon/api'
import { sendTasks } from '@taskyon/taskyon/api'
import {
  // from frp bux with only very few dependencies
  createDuplexChannel, // utis/frpbus
  MessageChannelBridge, // utils/frpbus

  type ClientTool,
  type TaskyonMessage,
} from '@taskyon/taskyon/api'
import type { partialTaskDraft } from '@taskyon/taskyon/api'
import type { TaskContentType, TaskNode } from '@taskyon/taskyon'
import type { ByType } from '@taskyon/taskyon'
// TODO: move this into some other part as well..  maybe into "GUI" types or somthing like that?
import type {
  partialTyConfiguration,
  TaskyonGuiMessage,
} from '../../../src/modules/taskyon/apiTypes'
import { sendFile } from '../../taskyon/src/types/apiTypes'
export {
  createChatCompletionTask,
  createTool, // toolApi
  makeTaskResult, // toolApi
  toolCall, // toolApi
  type partialTaskDraft,
} from '@taskyon/taskyon/api'
export type { ClientTool, partialTyConfiguration, TaskyonGuiMessage, TaskyonMessage }

export type processTasksOpts = {
  timeoutMs?: number
  signal?: AbortSignal
  show?: boolean
  throwOnError?: boolean
}

// we make the opts mandatory on purpose so that people think about
// some sort of quit condition.
export const processTasks = <T extends { type: string }>(tyPort: Port<T | TaskyonMessage>) => {
  const send = sendTasks<T>(tyPort)
  return async (
    taskList: partialTaskDraft[][],
    quitCondition: ((t: TaskNode) => boolean) | TaskContentType | TaskContentType[],
    opts: processTasksOpts,
  ) => {
    const { initialIds } = await send(taskList, opts)
    const subTasks = new Set<string>(initialIds)
    const subTaskStream = tyPort.receive
      .narrow((m): m is ByType<'taskCreated', TaskyonMessage> & { task: { id: string } } => {
        if (
          m.type === 'taskCreated' &&
          'task' in m &&
          !!m.task?.id &&
          !!m.task?.parentID &&
          subTasks.has(m.task.parentID)
        ) {
          subTasks.add(m.task.id)
          return true
        }
        return false
      })
      .map((msg) => msg.task)
    const expectsError =
      quitCondition === 'error' ||
      (Array.isArray(quitCondition) && quitCondition.includes('error'))
    const throwOnError = opts.throwOnError !== false && !expectsError
    const matchesQuitCondition =
      typeof quitCondition === 'string'
        ? (task: TaskNode) => task.content.type === quitCondition
        : typeof quitCondition === 'object' && Array.isArray(quitCondition)
          ? (task: TaskNode) => quitCondition.includes(task.content.type)
          : quitCondition

    return await new Promise<TaskNode>((resolve, reject) => {
      if (opts.signal?.aborted) {
        const err = new Error('Aborted')
        err.name = 'AbortError'
        reject(err)
        return
      }

      let settled = false
      let timeout: ReturnType<typeof setTimeout> | undefined

      const cleanup = (unsub: () => void, onAbort: () => void) => {
        unsub()
        clearTimeout(timeout)
        opts.signal?.removeEventListener('abort', onAbort)
      }

      const onAbort = () => {
        if (settled) return
        settled = true
        cleanup(unsub, onAbort)
        const err = new Error('Aborted')
        err.name = 'AbortError'
        reject(err)
      }

      const unsub = subTaskStream((task) => {
        if (settled) return

        if (throwOnError && task.content.type === 'error') {
          settled = true
          cleanup(unsub, onAbort)
          reject(new Error(`Task processing failed on task ${task.id}`, { cause: task.content.data }))
          return
        }

        if (matchesQuitCondition(task)) {
          settled = true
          cleanup(unsub, onAbort)
          resolve(task)
        }
      })

      if (opts.timeoutMs) {
        timeout = setTimeout(() => {
          if (settled) return
          settled = true
          cleanup(unsub, onAbort)
          reject(new Error(`Timeout after ${opts.timeoutMs}ms`))
        }, opts.timeoutMs)
      }

      opts.signal?.addEventListener('abort', onAbort)
    })
  }
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

async function handleFunctionExecution(
  args: FunctionCall['arguments'],
  tool: ClientTool,
  stopSignal: AbortSignal,
) {
  // with this we make sure, that we can also handle async functions :)
  const result = await tool.function(args, {
    taskChain: [],
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
    persist: options.persist,
    bindingKey: options.bindingKey,
    profileName: options.profileName,
    missingBindingKeyPolicy: options.missingBindingKeyPolicy,
    origin: window.location.origin,
    peerId: options?.name,
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

  console.log('tyclient set up function listener!')

  clientSidePort.receive((msg) => console.log('tyclient received message', msg))
  clientSidePort.receive.narrow((msg) => msg.type === 'functionCall')(async (msg) => {
    const tool = toolMap[msg.functionName]
    if (tool) {
      const res = await handleFunctionExecution(msg.arguments ?? {}, tool, controller.signal)
      send({ type: 'functionResponse', functionName: tool.name, response: res })
      console.log('tyclient tool send functionResponse to iframe', res, tool)
    }
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
      send({
        type: 'configurationMessage',
        conf: options.configuration,
        persist: options.persist,
        bindingKey: options.bindingKey,
        profileName: options.profileName,
        missingBindingKeyPolicy: options.missingBindingKeyPolicy,
        origin: window.location.origin,
        peerId: options?.name,
      })
    },
  }
}
