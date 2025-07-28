// we can compile this file to js to js using "yarn build:lib"

import type { partialTyConfiguration, TaskyonMessage } from '../taskyon/apiTypes'
import type { ClientTool } from '../taskyon/tools'

const waitForApiChannel = (iframe: HTMLIFrameElement) => {
  return new Promise<MessagePort>((resolve) => {
    let stop = false

    function tryConnect() {
      if (stop) return

      const channel = new MessageChannel()
      channel.port1.onmessage = (ev) => {
        console.log('received first message from taskyon!', ev)
        stop = true
        resolve(channel.port1)
      }
      try {
        iframe.contentWindow?.postMessage({ type: 'initPort' }, origin, [channel.port2])
      } catch {
        // ignore DataCloneError, not relevant with new channel
      }
      // Try again in 200ms if not resolved yet
      if (!stop) setTimeout(tryConnect, 200)
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
    // Check the origin to ensure security
    if (event.origin !== iframeTarget) {
      console.log('Received message from unauthorized origin')
      return
    }

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
      window.addEventListener('message', (event) => {
        void handleFunctionExecutionRequest(iframeTarget, tools, send, controller.signal)(event)
      })
    })
  }
}
