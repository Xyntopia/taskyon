import { createDuplexChannel } from '@taskyon/shared/modules/frpBus'
import { callToolOverRpc, registerToolRpcTools } from '../core/toolRpc'
import type { TaskyonMessage } from '../types/apiTypes'
import type {
  RemoteFunctionCall,
  RemoteFunctionCancel,
  RemoteFunctionResponse,
} from '../types/messages'
import { createTool } from '../types/toolApi'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

export const testRemoteFunctionBridgeHonorsToolTimeoutMs = async () => {
  const { x: workerPort, y: remotePort } = createDuplexChannel<
    RemoteFunctionCall | RemoteFunctionCancel,
    RemoteFunctionResponse
  >()
  const unsubscribe = remotePort.receive((msg) => {
    if (msg.type !== 'functionCall') return
    setTimeout(() => {
      remotePort.send({
        type: 'functionResponse',
        functionName: msg.functionName,
        requestId: msg.requestId,
        response: { ok: true },
      })
    }, 30_100)
  })

  try {
    const result = await callToolOverRpc(
      {
        name: 'slowRemote',
        arguments: { timeoutMs: 31_000 },
      },
      workerPort,
    )

    assert(
      typeof result === 'object' && result !== null && 'ok' in result && result.ok === true,
      'Expected remote function response after caller-provided timeoutMs',
    )
  } finally {
    unsubscribe()
  }

  return { success: true }
}

testRemoteFunctionBridgeHonorsToolTimeoutMs.description =
  'Honors a remote tool call timeoutMs value instead of timing out all remote bridge calls after 30 seconds.'
testRemoteFunctionBridgeHonorsToolTimeoutMs.timeoutMs = 35_000

export const testRemoteFunctionBridgeRegistersAndExecutesTool = async () => {
  const { x: clientPort, y: taskyonPort } = createDuplexChannel<TaskyonMessage, TaskyonMessage>()
  let callCount = 0
  const echoTool = createTool({
    name: 'remoteEcho',
    description: 'Echo a message through the remote tool bridge.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['message'],
      properties: {
        message: { type: 'string' },
      },
    } as const,
    function: ({ message }) => {
      callCount += 1
      return { echoed: message }
    },
  })

  const toolDescriptionPromise = taskyonPort.receive.wait({ timeoutMs: 1000 })
  const registrationPromise = registerToolRpcTools({ port: clientPort, tools: [echoTool] })

  const toolDescription = await toolDescriptionPromise
  if (toolDescription.type !== 'functionDescription') {
    throw new Error('expected functionDescription message')
  }
  assert(toolDescription.name === 'remoteEcho', 'expected remoteEcho registration')

  taskyonPort.send({
    type: 'status',
    data: {
      type: 'newtool',
      id: 'remoteEcho',
    },
  })
  const registration = await registrationPromise

  const responsePromise = taskyonPort.receive.wait({ timeoutMs: 1000 })
  taskyonPort.send({
    type: 'functionCall',
    functionName: 'remoteEcho',
    requestId: 'remote-echo-1',
    arguments: {
      message: 'hello',
    },
  })
  const response = await responsePromise

  registration.destroy()
  if (response.type !== 'functionResponse') {
    throw new Error('expected functionResponse message')
  }
  assert(response.functionName === 'remoteEcho', 'expected remoteEcho response')
  assert(response.requestId === 'remote-echo-1', 'expected matching request id')
  assert(!response.error, `expected no error, got ${String(response.error)}`)
  assert(
    typeof response.response === 'object' &&
      response.response !== null &&
      'echoed' in response.response &&
      response.response.echoed === 'hello',
    'expected echoed response payload',
  )
  assert(callCount === 1, 'expected tool to run exactly once')
}

testRemoteFunctionBridgeRegistersAndExecutesTool.description =
  'Registers a remote tool over the Taskyon port and executes it through the shared RPC executor.'
