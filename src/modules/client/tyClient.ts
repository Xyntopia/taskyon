// we can compile this file to js to js using "yarn build:lib"

import type { partialTyConfiguration, TaskyonMessage, ClientTool } from './tyClient.types'

const waitForApiChannel = (iframe: HTMLIFrameElement): Promise<MessagePort> => {
  return new Promise<MessagePort>((resolve) => {
    let stopped = false

    const tryConnect = () => {
      if (stopped) return

      const channel = new MessageChannel()

      // self‑destructing listener – removed automatically after it fires once
      const handleFirst: (ev: MessageEvent) => void = (ev) => {
        console.log('received first message from taskyon!', ev)
        stopped = true

        channel.port1.removeEventListener('message', handleFirst) // ⬅️ unsubscribe
        clearTimeout(retryTimer) // stop retry loop
        resolve(channel.port1) // hand over the port
      }

      channel.port1.addEventListener('message', handleFirst, { once: true })
      channel.port1.start() // ← wake the port so it can receive

      try {
        iframe.contentWindow?.postMessage({ type: 'initPort' }, origin, [channel.port2])
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
  iframeTarget: string,
  tools: ClientTool[],
  sendTyMessage: (message: TaskyonMessage) => void | undefined,
  stopSignal: AbortSignal,
) =>
  async function (event: MessageEvent<{ type: string; arguments: unknown }>): Promise<void> {
    console.log('received message:', event)
    // Handle function call
    const tool = tools[0]
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
      console.log('get secret name', name)
      return Promise.resolve('N/A')
    },
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    setSecret: (name, _value) => {
      console.log('set secret name', name)
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

export async function initializeTaskyon(
  tools: ClientTool[],
  configuration: partialTyConfiguration,
) {
  console.log('initialize taskyon client...')

  const taskyon = document.getElementById('taskyon') as HTMLIFrameElement

  const controller = new AbortController()

  if (taskyon !== null && taskyon.tagName === 'IFRAME' && taskyon.contentWindow !== null) {
    const iframeTarget = new URL(taskyon.src).origin

    const tyApi = await waitForApiChannel(taskyon)
    const send = (msg: TaskyonMessage) => tyApi.postMessage(msg)

    console.log('send our configuration!')
    send({
      type: 'configurationMessage',
      conf: configuration,
    })
    console.log('sending our functions!')
    tools.forEach((t) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { function: _toolfunc, ...fdescr } = t
      send({
        type: 'functionDescription',
        ...fdescr,
      })
      console.log('set up function listener!')
      tyApi.onmessage = (event) => {
        void handleFunctionExecutionRequest(iframeTarget, tools, send, controller.signal)(event)
      }
    })
  }
}
