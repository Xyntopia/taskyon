// we can compile this file to js to js using "yarn build:lib"

import type { ClientTool } from '@taskyon/taskyon'
export { createTool, makeTaskResult, toolCall } from '@taskyon/taskyon'
import type { partialTyConfiguration, TaskyonMessage } from 'src/modules/taskyon/apiTypes'

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
      console.log('tyclient establishing iframe communication to', targetOrigin)

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

const handleFunctionExecutionRequest = (
  tools: Record<string, ClientTool>,
  sendTyMessage: (message: TaskyonMessage) => void | undefined,
  stopSignal: AbortSignal,
) =>
  async function (
    event: MessageEvent<{ type: string; arguments: unknown; functionName: string }>,
  ): Promise<void> {
    console.log('tyclient received message:', event)
    // Handle function call
    const tool = tools[event.data.functionName]
    if (tool && event.data && event.data.type === 'functionCall') {
      //if the message comes from taskyon, we can be sure that its the correct type.
      await handleFunctionExecution(event, tool, sendTyMessage, stopSignal)
    }
  }

async function handleFunctionExecution(
  event: MessageEvent<{ type: string; arguments: unknown }>,
  tool: ClientTool,
  sendTyMessage: (message: TaskyonMessage) => void | undefined,
  stopSignal: AbortSignal,
) {
  const data = event.data
  // with this we make sure, that we can also handle async functions :)
  const result = await tool.function(data.arguments, {
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

  // Send response to iframe
  sendTyMessage({
    type: 'functionResponse',
    functionName: tool.name,
    response: result,
  })
}

export async function initializeTaskyon(options: {
  name?: string
  persist?: boolean
  tools: ClientTool[]
  configuration: partialTyConfiguration
}) {
  console.log('initialize taskyon tyclient...')

  const toolMap = options.tools.reduce<Record<string, ClientTool>>((p, c) => {
    p[c.name] = c
    return p
  }, {})

  const taskyon = document.getElementById('taskyon') as HTMLIFrameElement

  const controller = new AbortController()

  if (taskyon !== null && taskyon.tagName === 'IFRAME' && taskyon.contentWindow !== null) {
    console.log('make sure, we can ')
    const tyApi = await waitForApiChannel(taskyon)
    const send = (msg: TaskyonMessage) => {
      console.log('tyclient sending', msg)
      tyApi.postMessage(safeClone(msg))
    }

    console.log('tyclient send our configuration!')
    send({
      type: 'configurationMessage',
      conf: options.configuration,
      persist: options.persist,
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
      console.log('tyclient set up function listener!')
      tyApi.onmessage = (event) => {
        void handleFunctionExecutionRequest(toolMap, send, controller.signal)(event)
      }
    })
  }
}
