// we can compile this file to js to js using "yarn build:lib"

import type { partialTyConfiguration, TaskyonMessage } from '../taskyon/iframeApiTypes'
import type { ClientTool } from '../taskyon/tools'

const createTySend =
  (taskyon: HTMLIFrameElement, iframeTarget: string) => (message: TaskyonMessage) =>
    taskyon.contentWindow?.postMessage(message, iframeTarget)

const waitForTaskyonReady = (iframeTarget: string) => {
  return new Promise((resolve /*reject*/) => {
    const handleMessage = function (event: MessageEvent<{ type: string }>) {
      const eventOrigin = new URL(event.origin).origin
      if (eventOrigin === iframeTarget && event.data.type === 'taskyonReady') {
        window.removeEventListener('message', handleMessage)
        console.log('Received message that taskyon is ready!', event)
        resolve(event)
      }
    }

    console.log('waiting for taskyon to be ready....')
    window.addEventListener('message', handleMessage)
  })
}

const handleFunctionExecutionRequest = (
  iframeTarget: string,
  tools: ClientTool[],
  sendTyMessage: (message: TaskyonMessage) => void | undefined,
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
      await handleFunctionExecution(event, tool, sendTyMessage)
    }
  }

async function handleFunctionExecution(
  event: MessageEvent<{ type: string; arguments: unknown }>,
  tool: ClientTool,
  sendTyMessage: (message: TaskyonMessage) => void | undefined,
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
    },
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

  if (taskyon !== null && taskyon.tagName === 'IFRAME' && taskyon.contentWindow !== null) {
    const iframeTarget = new URL(taskyon.src).origin

    const sendTyMessage = createTySend(taskyon, iframeTarget)

    await waitForTaskyonReady(iframeTarget)
    console.log('send our configuration!')
    sendTyMessage({
      type: 'configurationMessage',
      conf: configuration,
    })
    console.log('sending our functions!')
    tools.forEach((t) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { function: _toolfunc, ...fdescr } = t
      sendTyMessage({
        type: 'functionDescription',
        id: fdescr.name,
        duplicateTaskName: false, // we use this here in order to prevent duplicate creation of our function declaration task
        ...fdescr,
      })
      console.log('set up function listener!')
      window.addEventListener('message', (event) => {
        void handleFunctionExecutionRequest(iframeTarget, tools, sendTyMessage)(event)
      })
    })
  }
}
